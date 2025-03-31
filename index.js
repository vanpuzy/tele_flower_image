const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const XLSX = require("xlsx");
const mysql = require("mysql2/promise");

const dbConfig = {
  host: "database-hpnrt.cz0i2cyea1x3.ap-northeast-2.rds.amazonaws.com",
  user: "admin",
  password: "12345678",
  database: "hpnrt"
};
TELEGRAM_BOT_PHUONG_TOKEN="6037137720:AAFBEfCG9xWY4K_3tx7VSZzMXGgmt9-Zdog"
TELEGRAM_BOT_DAT_TOKEN="7730662102:AAGqaftCXkjvX8QpDAJvtFpqvR59z6AfYJU"
BOT_TOKEN = TELEGRAM_BOT_PHUONG_TOKEN
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// API URL nhận file
const apiUrl = "http://222.255.250.26:8090/extract_bill_info/";

console.log(" bot dang chay")

function parseVietnameseDate(dateString) {
  const months = {
    "tháng 1": "01", "tháng 2": "02", "tháng 3": "03", "tháng 4": "04",
    "tháng 5": "05", "tháng 6": "06", "tháng 7": "07", "tháng 8": "08",
    "tháng 9": "09", "tháng 10": "10", "tháng 11": "11", "tháng 12": "12"
  };

  const currentYear = new Date().getFullYear(); // Lấy năm hiện tại
  let match = dateString.match(/Ngày (\d{1,2}) tháng (\d{1,2}) năm (\d{4})?/);

  if (!match) return null;

  let [, day, month, year] = match;
  year = year || currentYear; // Nếu không có năm, dùng năm hiện tại

  return `${year}-${months[`tháng ${month}`]}-${day.padStart(2, "0")}`;
}


bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  console.log("📥 Nhận ảnh từ chatID:", chatId);

  try {
    // Lấy fileId của ảnh lớn nhất
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileInfo = await bot.getFile(fileId);

    console.log("ℹ️ File Info:", fileInfo);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    console.log("🌍 File URL:", fileUrl);

    // Tạo đường dẫn lưu file tạm thời
    const fileExtension = path.extname(fileInfo.file_path);
    const fileName = `photo_${chatId}_${Date.now()}${fileExtension}`;
    const filePath = path.join(__dirname, fileName);

    // Tải ảnh về máy
    const response = await axios({ url: fileUrl, responseType: "stream" });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    console.log("✅ Ảnh đã tải về:", filePath);

    // Chuẩn bị FormData
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));

    // Gửi ảnh lên API
    const apiResponse = await axios.post(apiUrl, formData, {
      headers: formData.getHeaders(),
    });

    console.log("📤 Phản hồi từ API:", apiResponse.data);
    bot.sendMessage(chatId, `✅ Ảnh đã gửi đi thành công!`);

    // Xóa file sau khi upload
    fs.unlinkSync(filePath);

    console.log("📜 API Response:", apiResponse.data);

    // 4️⃣ Chuyển phản hồi JSON thành Excel
    const jsonData = apiResponse.data;
    const workbook = XLSX.utils.book_new();



    const sql_connection = await mysql.createConnection(dbConfig);

    // Sheet 1: Thông tin khách hàng
    const totalAmount = jsonData["Thông tin"].reduce((sum, item) => sum + item["thành tiền"], 0);
    const customerData = [
      ["Tên khách hàng", jsonData["Tên khách hàng"]],
      ["Địa chỉ", jsonData["Địa chỉ"]],
      ["Thời gian", jsonData["Thời gian"]],
      ["Tổng tiền", totalAmount],
    ];
    const sheet1 = XLSX.utils.aoa_to_sheet(customerData);
    XLSX.utils.book_append_sheet(workbook, sheet1, "Khách hàng");

        // Kiểm tra xem khách hàng đã tồn tại chưa
    const [existingCustomer] = await sql_connection.execute(
      "SELECT id FROM Customers WHERE name = ? AND address = ?",
      [jsonData["Tên khách hàng"], jsonData["Địa chỉ"]]
    );

    let customerId;
    if (existingCustomer.length > 0) {
      customerId = existingCustomer[0].id;
    } else {
      const [customerResult] = await sql_connection.execute(
        "INSERT INTO Customers (name, address) VALUES (?, ?)",
        [jsonData["Tên khách hàng"], jsonData["Địa chỉ"]]
      );
      customerId = customerResult.insertId;
    }

    const orderDate = parseVietnameseDate(jsonData["Thời gian"]);
    if (!orderDate) {
      bot.sendMessage(chatId, "❌ Lỗi định dạng ngày tháng.");
      return;
    }

    const [orderResult] = await sql_connection.execute(
      "INSERT INTO Orders (customer_id, order_date) VALUES (?, ?)",
      [customerId, orderDate]
    );
    const orderId = orderResult.insertId;


    // Sheet 2: Danh sách hàng hóa
    const headers = ["Thứ tự", "Tên mặt hàng", "Số lượng", "Đơn giá", "Thành tiền"];
    const dataRows = jsonData["Thông tin"].map(item => [
      item["thứ tự"], item["tên mặt hàng"], item["số lượng"], item["đơn giá"], item["thành tiền"]
    ]);

    for (const item of jsonData["Thông tin"]) {
      await sql_connection.execute(
        "INSERT INTO Order_Items (order_id, item_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)",
        [orderId, item["tên mặt hàng"], item["số lượng"], item["đơn giá"], item["thành tiền"]]
      );
    }

    await sql_connection.end();



    dataRows.push(["", "", "", "Tổng tiền", totalAmount]);
    const sheet2 = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    XLSX.utils.book_append_sheet(workbook, sheet2, "Danh sách hàng hóa");

    // 5️⃣ Lưu file Excel
    const excelFilePath = `./data_${chatId}.xlsx`;
    XLSX.writeFile(workbook, excelFilePath);
    
    console.log(`✅ File Excel đã tạo: ${excelFilePath}`);

    // 6️⃣ Gửi file Excel lại cho nhóm chat
    await bot.sendDocument(chatId, excelFilePath, {
      caption: "✅ File Excel đã được tạo!",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    // Xóa file Excel sau khi gửi
    fs.unlinkSync(excelFilePath);

  } catch (error) {
    console.error("❌ Lỗi:", error);
    bot.sendMessage(chatId, "❌ Có lỗi xảy ra khi xử lý ảnh.");
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim().toLowerCase() : "";

  if (text.startsWith("/report")) {
    const parts = text.split(" ");
    const days = parseInt(parts[1], 10) || 1; // Mặc định là 1 ngày nếu không có số ngày
    const excelFilePath = await generateReportForDays(days);

    if (!excelFilePath) {
      bot.sendMessage(chatId, `📭 Không có hóa đơn nào trong ${days} ngày gần đây.`);
      return;
    }

    await bot.sendDocument(chatId, excelFilePath, {
      caption: `📊 Báo cáo hóa đơn trong ${days} ngày gần đây.`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    fs.unlinkSync(excelFilePath);
  }
});

const generateReportForDays = async (days) => {
  console.log(`📥 Đang tổng hợp hóa đơn trong ${days} ngày gần đây`);
  const sql_connection = await mysql.createConnection(dbConfig);

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const formattedStartDate = startDate.toISOString().split("T")[0];

    const [orders] = await sql_connection.execute(
      "SELECT o.id, c.name AS customer_name, c.address, o.order_date FROM Orders o " +
      "JOIN Customers c ON o.customer_id = c.id " +
      "WHERE o.order_date >= ?",
      [formattedStartDate]
    );

    if (orders.length === 0) {
      await sql_connection.end();
      return null;
    }

    const workbook = XLSX.utils.book_new();
    
    for (const order of orders) {
      const sheetData = [["Tên Mặt Hàng", "Số Lượng", "Đơn Giá", "Thành Tiền"]];
      
      const [items] = await sql_connection.execute(
        "SELECT item_name, quantity, unit_price, total_price FROM Order_Items WHERE order_id = ?",
        [order.id]
      );
      
      let totalAmount = 0;
      for (const item of items) {
        sheetData.push([item.item_name, item.quantity, item.unit_price, item.total_price]);
        totalAmount += item.total_price;
      }
      
      sheetData.push([]); // Dòng trống
      sheetData.push(["Tổng tiền", "", "", totalAmount]);
      
      const sheet = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(workbook, sheet, `Hóa đơn ${order.id}`);
    }

    const excelFilePath = `./report_${days}_days.xlsx`;
    XLSX.writeFile(workbook, excelFilePath);

    await sql_connection.end();
    return excelFilePath;
  } catch (error) {
    console.error("❌ Lỗi khi tạo báo cáo:", error);
    await sql_connection.end();
    return null;
  }
};
