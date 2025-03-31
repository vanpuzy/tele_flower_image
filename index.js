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
TELEGRAM_BOT_PHUONG_TOKEN = "6037137720:AAFBEfCG9xWY4K_3tx7VSZzMXGgmt9-Zdog"
TELEGRAM_BOT_DAT_TOKEN = "7730662102:AAGqaftCXkjvX8QpDAJvtFpqvR59z6AfYJU"
BOT_TOKEN = TELEGRAM_BOT_PHUONG_TOKEN
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// API URL nhận file
const apiUrl = "http://222.255.250.26:8090/extract_bill_info/";

console.log(" bot dang chay")

function parseVietnameseDate(dateString) {
  const currentDate = new Date();
  const defaultDay = String(currentDate.getDate()).padStart(2, "0");
  const defaultMonth = String(currentDate.getMonth() + 1).padStart(2, "0");
  const defaultYear = String(currentDate.getFullYear());

  if (typeof dateString !== "string") {
    console.error("❌ Lỗi: dateString không phải là chuỗi hợp lệ", dateString);
    return `${defaultYear}-${defaultMonth}-${defaultDay}`;
  }

  const months = {
    "tháng 1": "01", "tháng 2": "02", "tháng 3": "03", "tháng 4": "04",
    "tháng 5": "05", "tháng 6": "06", "tháng 7": "07", "tháng 8": "08",
    "tháng 9": "09", "tháng 10": "10", "tháng 11": "11", "tháng 12": "12"
  };

  // Tìm các phần Ngày, Tháng, Năm
  const match = dateString.match(/(?:Ngày\s*(\d{1,2}))?\s*(?:tháng\s*(\d{1,2}))?\s*(?:năm\s*(\d{4}))?/i);

  if (!match) {
    console.error("❌ Lỗi: Không tìm thấy định dạng ngày tháng hợp lệ trong", dateString);
    return `${defaultYear}-${defaultMonth}-${defaultDay}`;
  }

  let [, day, month, year] = match;

  day = day ? day.padStart(2, "0") : defaultDay;
  month = month ? months[`tháng ${month}`] : defaultMonth;
  year = year || defaultYear;

  return `${year}-${month}-${day}`;
}


function parseVietnameseNumber(value) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return parseInt(value.replace(/\./g, ""), 10) || 0;
  }
  console.error("❌ Lỗi: Dữ liệu không hợp lệ", value);
  return 0;
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
    const totalAmount = jsonData["Thông tin"].reduce((sum, item) => sum + parseVietnameseNumber(item["thành tiền"]), 0);

    const customerData = [
      ["Tên khách hàng", jsonData["Tên khách hàng"]],
      ["Địa chỉ", jsonData["Địa chỉ"]],
      ["Thời gian", jsonData["Thời gian"]],
      ["Tổng tiền", totalAmount],
    ];
    const sheet1 = XLSX.utils.aoa_to_sheet(customerData);
    XLSX.utils.book_append_sheet(workbook, sheet1, "Khách hàng");


    const orderDate = parseVietnameseDate(jsonData["Thời gian"]);
    if (!orderDate) {
      bot.sendMessage(chatId, "❌ Lỗi định dạng ngày tháng.");
      return;
    }




    // Sheet 2: Danh sách hàng hóa
    const headers = ["Thứ tự", "Tên mặt hàng", "Số lượng", "Đơn giá", "Thành tiền"];
    const dataRows = jsonData["Thông tin"].map(item => [
      item["thứ tự"], item["tên mặt hàng"], item["số lượng"], parseVietnameseNumber(item["đơn giá"]), 
      parseVietnameseNumber(item["thành tiền"]) 
    ]);



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

    const [orderResult] = await sql_connection.execute(
      "INSERT INTO Orders (customer_id, order_date, totalAmount) VALUES (?, ?, ?)",
      [customerId, orderDate, totalAmount]
    );
    const orderId = orderResult.insertId;

    for (const item of jsonData["Thông tin"]) {
      const itemName = item["tên mặt hàng"] ? item["tên mặt hàng"] : null;
      await sql_connection.execute(
        "INSERT INTO Order_Items (order_id, item_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)",
        [orderId, itemName, item["số lượng"],  parseVietnameseNumber(item["đơn giá"]), 
        parseVietnameseNumber(item["thành tiền"]) ]
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
    startDate.setDate(startDate.getDate() - days +1);
    const formattedStartDate = startDate.toISOString().split("T")[0];

    const [orders] = await sql_connection.execute(
      `SELECT o.id, c.name AS customer_name, c.address, o.order_date, 
              SUM(oi.total_price) AS total_amount
       FROM Orders o 
       JOIN Customers c ON o.customer_id = c.id 
       JOIN Order_Items oi ON o.id = oi.order_id
       WHERE o.order_date >= ?
       GROUP BY o.id, c.name, c.address, o.order_date`,
      [formattedStartDate]
    );

    if (orders.length === 0) {
      await sql_connection.end();
      return null;
    }

    const workbook = XLSX.utils.book_new();

    // Tạo sheet tổng hợp
    const summarySheetData = [["ID Hóa Đơn", "Tên Khách Hàng", "Địa Chỉ", "Ngày Đặt Hàng", "Tổng Tiền"]];
    for (const order of orders) {
      summarySheetData.push([order.id, order.customer_name, order.address, order.order_date, order.total_amount]);
    }
    const summarySheet = XLSX.utils.aoa_to_sheet(summarySheetData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Tổng hợp");

    // Thêm từng hóa đơn vào sheet riêng
    for (const order of orders) {
      const sheetData = [["Tên Mặt Hàng", "Số Lượng", "Đơn Giá", "Thành Tiền"]];

      const [items] = await sql_connection.execute(
        "SELECT item_name, quantity, unit_price, total_price FROM Order_Items WHERE order_id = ?",
        [order.id]
      );

      for (const item of items) {
        sheetData.push([item.item_name, item.quantity, item.unit_price, item.total_price]);
      }

      sheetData.push([]); // Dòng trống
      sheetData.push(["Tổng tiền", "", "", order.total_amount]);

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

bot.onText(/\/khachhang/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const connection = await mysql.createConnection(dbConfig);
    const [customers] = await connection.execute("SELECT id, name FROM Customers");

    if (customers.length === 0) {
      return bot.sendMessage(chatId, "❌ Không có khách hàng nào trong database.");
    }

    // Tạo Inline Keyboard
    const keyboard = {
      inline_keyboard: customers.map((customer) => [
        { text: customer.name, callback_data: `customer_${customer.id}_${customer.name}` },
      ]),
    };

    bot.sendMessage(chatId, "📋 Danh sách khách hàng:", {
      reply_markup: keyboard,
    });

    await connection.end();
  } catch (error) {
    console.error("Lỗi lấy danh sách khách hàng:", error);
    bot.sendMessage(chatId, "❌ Lỗi khi lấy danh sách khách hàng.");
  }
});

// Xử lý khi người dùng chọn khách hàng
bot.on("callback_query", async (callbackQuery) => {
  const msg = callbackQuery.message;
  const data = callbackQuery.data;

  if (data.startsWith("customer_")) {
    const parts = data.split("_");
    const customerId = parts[1];
    const customerName = parts.slice(2).join("_"); // Ghép lại tên khách hàng nếu có dấu cách
    
    bot.sendMessage(msg.chat.id, `✅ Bạn đã chọn khách hàng: ${customerName}`);
    
    // Gọi hàm tạo báo cáo với customerName
    const reportPath = await generateReportForCustomer(customerName);
    if (reportPath) {
      bot.sendDocument(msg.chat.id, reportPath, { caption: "📊 Báo cáo hóa đơn của bạn." });
    } else {
      bot.sendMessage(msg.chat.id, "❌ Không có hóa đơn nào trong khoảng thời gian này.");
    }
  }
});

const generateReportForCustomer = async (customerName) => {
  console.log(`📥 Đang tổng hợp toàn bộ hóa đơn cho khách hàng: ${customerName}`);
  const sql_connection = await mysql.createConnection(dbConfig);

  try {
    const [orders] = await sql_connection.execute(
      `SELECT o.id, c.name AS customer_name, c.address, o.order_date, 
              SUM(oi.total_price) AS total_amount
       FROM Orders o 
       JOIN Customers c ON o.customer_id = c.id 
       JOIN Order_Items oi ON o.id = oi.order_id
       WHERE c.name = ?
       GROUP BY o.id, c.name, c.address, o.order_date`,
      [customerName]
    );

    if (orders.length === 0) {
      await sql_connection.end();
      return null;
    }

    const workbook = XLSX.utils.book_new();

    // Tạo sheet tổng hợp
    const summarySheetData = [["ID Hóa Đơn", "Tên Khách Hàng", "Địa Chỉ", "Ngày Đặt Hàng", "Tổng Tiền"]];
    for (const order of orders) {
      summarySheetData.push([order.id, order.customer_name, order.address, order.order_date, order.total_amount]);
    }
    const summarySheet = XLSX.utils.aoa_to_sheet(summarySheetData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Tổng hợp");

    // Thêm từng hóa đơn vào sheet riêng
    for (const order of orders) {
      const sheetData = [["Tên Mặt Hàng", "Số Lượng", "Đơn Giá", "Thành Tiền"]];

      const [items] = await sql_connection.execute(
        "SELECT item_name, quantity, unit_price, total_price FROM Order_Items WHERE order_id = ?",
        [order.id]
      );

      for (const item of items) {
        sheetData.push([item.item_name, item.quantity, item.unit_price, item.total_price]);
      }

      sheetData.push([]); // Dòng trống
      sheetData.push(["Tổng tiền", "", "", order.total_amount]);

      const sheet = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(workbook, sheet, `Hóa đơn ${order.id}`);
    }

    const excelFilePath = `./report_all_time_${customerName}.xlsx`;
    XLSX.writeFile(workbook, excelFilePath);

    await sql_connection.end();
    return excelFilePath;
  } catch (error) {
    console.error("❌ Lỗi khi tạo báo cáo:", error);
    await sql_connection.end();
    return null;
  }
};

const generateDateKeyboard = () => {
  const today = new Date();
  let keyboard = { inline_keyboard: [] };

  for (let i = 0; i < 7; i++) {
    let date = new Date();
    date.setDate(today.getDate() - i);
    let formattedDate = date.toISOString().split("T")[0];

    keyboard.inline_keyboard.push([
      { text: formattedDate, callback_data: `date_${formattedDate}` },
    ]);
  }

  return keyboard;
};

bot.onText(/\/chonngay/, (msg) => {
  const chatId = msg.chat.id;
  
  const years = [2025,2024, 2023, 2022, 2021]; // Danh sách năm có sẵn
  const buttons = years.map((year) => [{ text: `${year}`, callback_data: `year_${year}` }]);

  bot.sendMessage(chatId, "📅 Chọn năm:", {
    reply_markup: { inline_keyboard: buttons }
  });
});

bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("year_")) {
    const selectedYear = data.split("_")[1];

    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const buttons = months.map((month) => [{ text: `Tháng ${month}`, callback_data: `month_${selectedYear}_${month}` }]);

    bot.editMessageText(`✅ Đã chọn năm: ${selectedYear}\n📆 Chọn tháng:`, {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: { inline_keyboard: buttons }
    });
  }
});

bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("month_")) {
    const [_, year, month] = data.split("_");

    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    const buttons = days.map((day) => [{ text: `Ngày ${day}`, callback_data: `day_${year}_${month}_${day}` }]);

    bot.editMessageText(`✅ Đã chọn tháng: ${month}/${year}\n📅 Chọn ngày:`, {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: { inline_keyboard: buttons }
    });
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("day_")) {
    const [_, year, month, day] = data.split("_");
    const selectedDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

    bot.sendMessage(chatId, `📅 Bạn đã chọn ngày: ${selectedDate}\n🔄 Đang tạo báo cáo...`);

    const filePath = await generateReportForDate(selectedDate);
    if (filePath) {
      bot.sendDocument(chatId, filePath);
    } else {
      bot.sendMessage(chatId, "❌ Không có hóa đơn cho ngày này.");
    }
  }
});

const generateReportForDate = async (date) => {
  console.log(`\uD83D\uDCE5 Đang tổng hợp hóa đơn cho ngày ${date}`);
  const sql_connection = await mysql.createConnection(dbConfig);

  try {
    const [orders] = await sql_connection.execute(
      `SELECT o.id, c.name AS customer_name, c.address, o.order_date, 
              o.totalAmount AS total_amount
       FROM Orders o 
       JOIN Customers c ON o.customer_id = c.id 
       WHERE o.order_date = ?`,
      [date]
    );

    if (orders.length === 0) {
      await sql_connection.end();
      return null;
    }

    const workbook = XLSX.utils.book_new();

    // Tạo sheet tổng hợp
    const summarySheetData = [["ID Hóa Đơn", "Tên Khách Hàng", "Địa Chỉ", "Ngày Đặt Hàng", "Tổng Tiền"]];
    for (const order of orders) {
      summarySheetData.push([order.id, order.customer_name, order.address, order.order_date, order.total_amount]);
    }
    const summarySheet = XLSX.utils.aoa_to_sheet(summarySheetData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Tổng hợp");

    // Thêm từng hóa đơn vào sheet riêng
    for (const order of orders) {
      const sheetData = [["Tên Mặt Hàng", "Số Lượng", "Đơn Giá", "Thành Tiền"]];

      const [items] = await sql_connection.execute(
        "SELECT item_name, quantity, unit_price, total_price FROM Order_Items WHERE order_id = ?",
        [order.id]
      );

      for (const item of items) {
        sheetData.push([item.item_name, item.quantity, item.unit_price, item.total_price]);
      }

      sheetData.push([]); // Dòng trống
      sheetData.push(["Tổng tiền", "", "", order.total_amount]);

      const sheet = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(workbook, sheet, `Hóa đơn ${order.id}`);
    }

    const excelFilePath = `./report_${date}.xlsx`;
    XLSX.writeFile(workbook, excelFilePath);

    await sql_connection.end();
    return excelFilePath;
  } catch (error) {
    console.error("❌ Lỗi khi tạo báo cáo:", error);
    await sql_connection.end();
    return null;
  }
};