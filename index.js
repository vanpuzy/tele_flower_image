﻿const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const XLSX = require("xlsx");
const mysql = require("mysql2/promise");


require('dotenv').config();

// const dbConfig = {
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME
// };

const dbConfig = {
  host: "database-hpnrt.cz0i2cyea1x3.ap-northeast-2.rds.amazonaws.com",
  user: "admin",
  password: "12345678",
  database: "hpnrt"
};

TELEGRAM_BOT_PHUONG_TOKEN = "6037137720:AAFBEfCG9xWY4K_3tx7VSZzMXGgmt9-Zdog"
TELEGRAM_BOT_DAT_TOKEN = "7730662102:AAGqaftCXkjvX8QpDAJvtFpqvR59z6AfYJU"
//BOT_TOKEN = TELEGRAM_BOT_PHUONG_TOKEN//process.env.TELEGRAM_BOT_TOKEN
BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// API URL nhận file
const apiUrl = process.env.API_URL //"http://222.255.250.26:8090/extract_bill_info/";
console.log(" bot dang chay")

const userStates = {};
const awaitingOrderReportDays = {};

async function downloadPhoto(fileId, chatId, bot, BOT_TOKEN) {
  const fileInfo = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
  const fileExtension = path.extname(fileInfo.file_path);
  const fileName = `photo_${chatId}_${Date.now()}${fileExtension}`;
  const filePath = path.join(__dirname, fileName);

  const response = await axios({ url: fileUrl, responseType: "stream" });
  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  return filePath;
}

async function uploadPhoto(filePath, apiUrl) {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));

  const response = await axios.post(apiUrl, formData, {
    headers: formData.getHeaders(),
  });

  fs.unlinkSync(filePath);
  return response.data;
}

function generateExcel(jsonData, chatId) {
  const workbook = XLSX.utils.book_new();

  // Calculate totalAmount as the sum of quantity * unit price for each item
  const totalAmount = jsonData["Thông tin"].reduce((sum, item) => {
    const unitPrice = parseVietnameseNumber(item["đơn giá"]);
    const quantity = item["số lượng"];
    const itemTotal = unitPrice * quantity;
    return sum + itemTotal;
  }, 0);

  // Prepare customer data for the first sheet
  const customerData = [
    ["Tên khách hàng", jsonData["Tên khách hàng"]],
    ["Địa chỉ", jsonData["Địa chỉ"]],
    ["Thời gian", jsonData["Thời gian"]],
    ["Tổng tiền", totalAmount],
  ];
  const sheet1 = XLSX.utils.aoa_to_sheet(customerData);
  XLSX.utils.book_append_sheet(workbook, sheet1, "Khách hàng");

  // Prepare headers for the second sheet
  const headers = ["Thứ tự", "Tên mặt hàng", "Số lượng", "Đơn giá", "Thành tiền"];

  // Prepare rows with calculated 'thành tiền'
  const dataRows = jsonData["Thông tin"].map(item => {
    const unitPrice = parseVietnameseNumber(item["đơn giá"]);
    const quantity = item["số lượng"];
    const itemTotal = unitPrice * quantity;
    return [
      item["thứ tự"], item["tên mặt hàng"], quantity, unitPrice, itemTotal
    ];
  });

  // Add the total amount row at the bottom
  dataRows.push(["", "", "", "Tổng tiền", totalAmount]);

  // Create the second sheet with headers and data
  const sheet2 = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  XLSX.utils.book_append_sheet(workbook, sheet2, "Danh sách hàng hóa");

  // Specify the file path and save the workbook
  const excelFilePath = `./data_${chatId}.xlsx`;
  XLSX.writeFile(workbook, excelFilePath);

  return excelFilePath;
}


async function saveOrderToDatabase(chatId, jsonData, sql_connection) {
  const totalAmount = jsonData["Thông tin"].reduce(
    (sum, item) => sum + parseVietnameseNumber(item["thành tiền"]),
    0
  );
  const orderDate = parseVietnameseDate(jsonData["Thời gian"]);

  // Kiểm tra xem khách hàng đã tồn tại chưa
  const [existingCustomer] = await sql_connection.execute(
    "SELECT id FROM Customers WHERE name = ?",
    [jsonData["Tên khách hàng"]]
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

  // Lấy danh sách đơn hàng có cùng khách hàng, ngày, và tổng tiền
  const [existingOrders] = await sql_connection.execute(
    "SELECT id FROM Orders WHERE customer_id = ? AND order_date = ? AND totalAmount = ?",
    [customerId, orderDate, totalAmount]
  );

  // Chuẩn hóa danh sách sản phẩm
  const normalizeItems = (items) => {
    return items.map(item => ({
      item_name: (item.item_name ? item.item_name.trim().toLowerCase() : "unknown item"),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      total_price: Number(item.total_price),
    })).sort((a, b) => a.item_name.localeCompare(b.item_name) || a.unit_price - b.unit_price);
  };

  // Chuẩn hóa danh sách sản phẩm từ jsonData
  const normalizedCurrentItems = normalizeItems(jsonData["Thông tin"].map(item => ({
    item_name: item["tên mặt hàng"] ? item["tên mặt hàng"].trim().toLowerCase() : "unknown item",
    quantity: item["số lượng"],
    unit_price: parseVietnameseNumber(item["đơn giá"]),
    total_price: parseVietnameseNumber(item["đơn giá"]) * item["số lượng"],
  })));

  if (existingOrders.length > 0) {
    for (const order of existingOrders) {
      const orderId = order.id;

      // Lấy danh sách sản phẩm của đơn hàng trong DB
      const [existingItems] = await sql_connection.execute(
        "SELECT item_name, quantity, unit_price, total_price FROM Order_Items WHERE order_id = ?",
        [orderId]
      );

      const normalizedExistingItems = normalizeItems(existingItems);

      console.log(`🔹 So sánh với đơn hàng ID: ${orderId}`);
      console.log("🔹 Existing Items:", JSON.stringify(normalizedExistingItems, null, 2));
      console.log("🔹 Current Items:", JSON.stringify(normalizedCurrentItems, null, 2));

      // Kiểm tra trùng lặp
      if (JSON.stringify(normalizedExistingItems) === JSON.stringify(normalizedCurrentItems)) {
        console.log(`❌ Đơn hàng đã tồn tại với ID: ${orderId}, không thêm vào cơ sở dữ liệu.`);
        bot.sendMessage(chatId, `❌ Đơn hàng đã tồn tại với ID: ${orderId}, không thêm vào cơ sở dữ liệu.`);
        return true;
      }
    }
  }

  console.log("✅ Không tìm thấy đơn hàng trùng, thêm mới đơn hàng...");

  // Nếu không tìm thấy đơn hàng trùng, thêm đơn hàng mới
  const [orderResult] = await sql_connection.execute(
    "INSERT INTO Orders (customer_id, order_date, totalAmount) VALUES (?, ?, ?)",
    [customerId, orderDate, totalAmount]
  );
  const orderId = orderResult.insertId;

  // Thêm sản phẩm vào Order_Items
  for (const item of jsonData["Thông tin"]) {
    const unitPrice = parseVietnameseNumber(item["đơn giá"]);
    const quantity = item["số lượng"];
    const itemTotal = unitPrice * quantity;

    await sql_connection.execute(
      "INSERT INTO Order_Items (order_id, item_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)",
      [orderId,
        item["tên mặt hàng"] ? item["tên mặt hàng"].trim() : "unknown item",
        quantity, unitPrice, itemTotal
      ]
    );
  }

  return false;
}


bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  console.log("📥 Nhận ảnh từ chatID:", chatId);
  bot.sendMessage(chatId, "📥 Đã nhận ảnh, đang chờ xử lý ...")

  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const filePath = await downloadPhoto(fileId, chatId, bot, BOT_TOKEN);
    console.log("✅ Ảnh đã tải về:", filePath);

    const jsonData = await uploadPhoto(filePath, apiUrl);
    console.log("📤 Phản hồi từ API:", jsonData);

    const sql_connection = await mysql.createConnection(dbConfig);
    const isDuplicate = await saveOrderToDatabase(chatId, jsonData, sql_connection);
    await sql_connection.end();

    if (!isDuplicate) {
      const excelFilePath = generateExcel(jsonData, chatId);
      console.log("✅ File Excel đã tạo:", excelFilePath);

      await bot.sendDocument(chatId, excelFilePath, {
        caption: "✅ File Excel đã được tạo!",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });

      fs.unlinkSync(excelFilePath);
    } else {

    }
  } catch (error) {
    console.error("❌ Lỗi:", error);
    bot.sendMessage(chatId, "❌ Có lỗi xảy ra khi xử lý ảnh.");
  }
});


bot.onText(/\/menu/, (msg) => {
  const chatId = msg.chat.id;

  if (userStates[chatId]) {
    delete userStates[chatId];
    console.log(`✅ Xóa userStates[${chatId}]`);
  } else {
    console.log(`⚠️ Không có userStates[${chatId}] để xóa`);
  }

  if (awaitingOrderReportDays[chatId]) {
    delete awaitingOrderReportDays[chatId];
    console.log(`✅ Xóa awaitingOrderReportDays[${chatId}]`);
  } else {
    console.log(`⚠️ Không có awaitingOrderReportDays[${chatId}] để xóa`);
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: "📊 Báo cáo Hóa Đơn ", callback_data: "menu_report" }],
      [{ text: "📋 Danh sách Khách Hàng", callback_data: "menu_customers" }],
      [{ text: "📅 Chọn Hóa Đơn theo Ngày", callback_data: "menu_date" }],
      [{ text: "📊 Báo cáo mặt hàng", callback_data: "menu_items" }],
      [{ text: "📊 Xuất tất cả hóa đơn", callback_data: "menu_all_reports" }],
      [{ text: "🗑 Xóa hóa đơn", callback_data: "menu_delete_order" }], // ➡️ Thêm m
    ]
  };

  bot.sendMessage(chatId, "📌 Chọn chức năng:", {
    reply_markup: keyboard
  });
});

// Xử lý callback từ menu
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  bot.answerCallbackQuery(callbackQuery.id);
  if (data === "menu_report") {
    bot.sendMessage(chatId, "📆 Vui lòng nhập số ngày bạn muốn xem báo cáo:");

    // Đánh dấu rằng người dùng đang nhập số ngày
    userStates[chatId] = { awaitingReportDays: true };
    // bot.sendMessage(chatId, "Nhập lệnh: `/report <số ngày>` để lấy báo cáo.", { parse_mode: "Markdown" });
  } else if (data === "menu_customers") {
    await handleCustomersRequest(chatId)
    // Giả lập gọi lại lệnh /khachhang
    bot.emit("text", { chat: { id: chatId }, text: "/khachhang" });
  } else if (data === "menu_date") {
    await handleDateRequest(chatId)
    bot.emit("text", { chat: { id: chatId }, text: "/chonngay" });
  } else if (data === "menu_items") {
    bot.sendMessage(chatId, "📅 Nhập số ngày muốn tổng hợp dữ liệu:");
    awaitingOrderReportDays[chatId] = true;
  }
  else if (data === "menu_all_reports") {
    bot.sendMessage(chatId, "⏳ Đang tổng hợp hóa đơn");


    // Gọi hàm tạo báo cáo
    const excelFilePath = await generateAllReports();

    if (!excelFilePath) {
      bot.sendMessage(chatId, `📭 Không có hóa đơn nào.`);
      return;
    }

    await bot.sendDocument(chatId, excelFilePath, {
      caption: `📊 Báo cáo hóa đơn.`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    fs.unlinkSync(excelFilePath);
  }

  if (data === "menu_delete_order") {
    const deleteKeyboard = {
      inline_keyboard: [
        [{ text: "🗑 Xóa theo tên khách hàng", callback_data: "delete_by_customer" }],
        [{ text: "🗑 Xóa theo ID hóa đơn", callback_data: "delete_by_order_id" }],
        [{ text: "⬅️ Quay lại", callback_data: "menu" }]
      ]
    };

    bot.sendMessage(chatId, "🔴 Chọn cách xóa hóa đơn:", { reply_markup: deleteKeyboard });
  }

  // Lấy danh sách khách hàng để chọn
  if (data === "delete_by_customer") {
    await deleteOrderByCustomer(chatId);
  }

  // Lựa chọn hóa đơn sau khi chọn khách hàng
  if (data.startsWith("select_customer_")) {
    const customerId = data.split("_")[2];
    await deleteAllOrdersByCustomer(chatId, customerId);
  }

  // Xóa hóa đơn khi chọn từ danh sách
  if (data.startsWith("delete_order_")) {
    const orderId = data.split("_")[2];

    db.query("DELETE FROM Orders WHERE id = ?", [orderId], (err, result) => {
      if (err) {
        bot.sendMessage(chatId, "❌ Lỗi khi xóa hóa đơn.");
        console.error(err);
        return;
      }

      bot.sendMessage(chatId, `✅ Đã xóa hóa đơn có ID: ${orderId}.`);
    });
  }

  // Xóa hóa đơn theo ID nhập tay
  if (data === "delete_by_order_id") {
    bot.sendMessage(chatId, "✏️ Nhập ID hóa đơn cần xóa:");
    userStates[chatId] = "waiting_delete_order_id";
  }



});

// bot.on("message", async (msg) => {
//   const chatId = msg.chat.id;
//   const text = msg.text ? msg.text.trim().toLowerCase() : "";

//   if (text.startsWith("/report")) {
//     const parts = text.split(" ");
//     const days = parseInt(parts[1], 10) || 1; // Mặc định là 1 ngày nếu không có số ngày
//     const excelFilePath = await generateReportForDays(days);
//     bot.sendMessage(chatId, `📊  Đang tổng hợp hóa đơn trong ${days} ngày gần đây.`);

//     if (!excelFilePath) {
//       bot.sendMessage(chatId, `📭 Không có hóa đơn nào trong ${days} ngày gần đây.`);
//       return;
//     }

//     await bot.sendDocument(chatId, excelFilePath, {
//       caption: `📊 Báo cáo hóa đơn trong ${days} ngày gần đây.`,
//       contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
//     });

//     fs.unlinkSync(excelFilePath);
//   }
// });


bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : "";

  // Kiểm tra nếu người dùng đang nhập số ngày
  if (userStates[chatId]?.awaitingReportDays) {
    const days = parseInt(text, 10);

    if (isNaN(days) || days <= 0) {
      bot.sendMessage(chatId, "❌ Vui lòng nhập một số ngày hợp lệ (lớn hơn 0).");
      return;
    }

    // Xóa trạng thái chờ nhập số ngày
    delete userStates[chatId];

    bot.sendMessage(chatId, `⏳ Đang tổng hợp báo cáo trong ${days} ngày gần đây...`);

    // Gọi hàm tạo báo cáo
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

  if (userStates[chatId] === "waiting_delete_order_id") {
    const orderId = parseInt(text);
    console.log(" orderId  " + orderId)
    if (isNaN(orderId)) {
      bot.sendMessage(chatId, "⚠️ Vui lòng nhập một số hợp lệ.");
      return;
    }

    deleteOrderById(chatId, orderId)

    delete userStates[chatId];
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (msg.text) {
    const text = msg.text.trim();

    if (awaitingOrderReportDays[chatId]) {
      const days = parseInt(text, 10);
      if (!isNaN(days) && days > 0) {
        bot.sendMessage(chatId, `🔄 Đang tạo báo cáo tổng hợp ${days} ngày gần nhất...`);
        await generateOrderItemReport(chatId, days);
      } else {
        bot.sendMessage(chatId, "⚠️ Vui lòng nhập số ngày hợp lệ (lớn hơn 0).");
      }
      delete awaitingOrderReportDays[chatId]; // Reset trạng thái nhập số ngày
    }
  }
});

// bot.onText(/\/khachhang/, async (msg) => {
async function handleCustomersRequest(chatId) {
  try {
    const connection = await mysql.createConnection(dbConfig);

    // Chỉ lấy khách hàng có ít nhất 1 đơn hàng
    const [customers] = await connection.execute(
      `SELECT DISTINCT c.id, c.name 
         FROM Customers c
         INNER JOIN Orders o ON c.id = o.customer_id`
    );

    if (customers.length === 0) {
      return bot.sendMessage(chatId, "❌ Không có khách hàng nào có hóa đơn trong database.");
    }

    console.log("Danh sách khách hàng có hóa đơn từ database:", customers);

    // Tạo Inline Keyboard
    const keyboard = {
      inline_keyboard: customers.map((customer) => [
        { text: customer.name, callback_data: `customer_${customer.id}_${customer.name}` },
      ]),
    };

    bot.sendMessage(chatId, "📋 Danh sách khách hàng có hóa đơn:", {
      reply_markup: keyboard,
    });

    await connection.end();
  } catch (error) {
    console.error("Lỗi lấy danh sách khách hàng:", error);
    bot.sendMessage(chatId, "❌ Lỗi khi lấy danh sách khách hàng.");
  }
}

// });

// bot.onText(/\/chonngay/, (msg) => {
async function handleDateRequest(chatId) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i); // Lấy 5 năm gần nhất

  const buttons = years.map((year) => [{ text: `${year}`, callback_data: `year_${year}` }]);

  bot.sendMessage(chatId, "📅 Chọn năm:", {
    reply_markup: { inline_keyboard: buttons }
  });
}
// });

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  // Gửi thông báo ngay lập tức để tránh lỗi timeout
  bot.answerCallbackQuery(query.id, { text: "⏳ Đang xử lý, vui lòng chờ..." }).catch((err) => console.error("Lỗi answerCallbackQuery:", err));
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

  else if (data.startsWith("month_")) {
    const [_, year, month] = data.split("_");

    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    // Chia các ngày thành các hàng, mỗi hàng chứa tối đa 2 nút
    const buttons = [];
    const maxOptionsPerRow = 2;

    for (let i = 0; i < days.length; i++) {
      // Thêm nút cho mỗi ngày
      if (i % maxOptionsPerRow === 0) buttons.push([]); // Tạo một hàng mới nếu đủ số cột
      buttons[buttons.length - 1].push({
        text: `Ngày ${days[i]}`,
        callback_data: `day_${year}_${month}_${days[i]}`
      });
    }
    bot.editMessageText(`✅ Đã chọn tháng: ${month}/${year}\n📅 Chọn ngày:`, {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: { inline_keyboard: buttons }
    });
  }

  else if (data.startsWith("day_")) {
    const [_, year, month, day] = data.split("_");
    const selectedDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

    bot.sendMessage(chatId, `📅 Bạn đã chọn ngày: ${selectedDate}\n🔄 Đang tạo báo cáo...`);

    const filePath = await generateReportForDate(selectedDate);
    if (filePath) {
      await bot.sendDocument(chatId, filePath);
      fs.unlinkSync(filePath);
    } else {
      bot.sendMessage(chatId, "❌ Không có hóa đơn cho ngày này.");
    }
  }

  if (data.startsWith("customer_")) {
    const parts = data.split("_");
    const customerId = parts[1];
    const customerName = parts.slice(2).join("_"); // Ghép lại tên khách hàng nếu có dấu cách

    const days = await askForDays(chatId, customerName);
    userStates[chatId] = { awaitingCustomerDays: true, customerName };
    if (days !== null) {
      // Tạo báo cáo cho khách hàng theo số ngày
      const reportPath = await generateCustomerReport(customerName, days);
      if (reportPath) {
        await bot.sendDocument(chatId, reportPath, { caption: "📊 Báo cáo hóa đơn của bạn." });
        fs.unlinkSync(reportPath); // Xóa tệp sau khi gửi
      } else {
        bot.sendMessage(chatId, "❌ Không có hóa đơn nào trong khoảng thời gian này.");
      }
    }
  }

  bot.answerCallbackQuery(query.id);

});


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
    "tháng 9": "09", "tháng 10": "10", "tháng 11": "11", "tháng 12": "12",

    "tháng 01": "01", "tháng 02": "02", "tháng 03": "03", "tháng 04": "04",
    "tháng 05": "05", "tháng 06": "06", "tháng 07": "07", "tháng 08": "08",
    "tháng 09": "09"
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
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return parseInt(value.replace(/\./g, ""), 10) || 0;
  }
  console.error("❌ Lỗi: Dữ liệu không hợp lệ", value);
  return 0;
}

// Hàm lấy danh sách hóa đơn theo điều kiện
const fetchOrders = async (condition, params) => {
  const sql_connection = await mysql.createConnection(dbConfig);
  try {
    const [orders] = await sql_connection.execute(
      `SELECT o.id, c.name AS customer_name, c.address, o.order_date, 
                    SUM(oi.total_price) AS total_amount
             FROM Orders o 
             JOIN Customers c ON o.customer_id = c.id 
             JOIN Order_Items oi ON o.id = oi.order_id
             WHERE ${condition}
             GROUP BY o.id, c.name, c.address, o.order_date`,
      params
    );
    await sql_connection.end();
    return orders;
  } catch (error) {
    console.error("❌ Lỗi khi truy vấn hóa đơn:", error);
    await sql_connection.end();
    return [];
  }
};

// Hàm lấy danh sách sản phẩm theo order_id
const fetchOrderItems = async (orderId) => {
  const sql_connection = await mysql.createConnection(dbConfig);
  try {
    const [items] = await sql_connection.execute(
      "SELECT item_name, quantity, unit_price, total_price FROM Order_Items WHERE order_id = ?",
      [orderId]
    );
    await sql_connection.end();
    return items;
  } catch (error) {
    console.error("❌ Lỗi khi truy vấn sản phẩm trong hóa đơn:", error);
    await sql_connection.end();
    return [];
  }
};

// Hàm tạo file Excel
const generateExcelReport = async (orders, filePath) => {
  if (orders.length === 0) return null;

  const workbook = XLSX.utils.book_new();
  const summarySheetData = [["ID Hóa Đơn", "Tên Khách Hàng", "Địa Chỉ", "Ngày Đặt Hàng", "Tổng Tiền"]];

  for (const order of orders) {
    summarySheetData.push([order.id, order.customer_name, order.address, order.order_date, order.total_amount]);
  }
  const summarySheet = XLSX.utils.aoa_to_sheet(summarySheetData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Tổng hợp");

  for (const order of orders) {
    const sheetData = [["Tên Mặt Hàng", "Số Lượng", "Đơn Giá", "Thành Tiền"]];
    const items = await fetchOrderItems(order.id);

    for (const item of items) {
      sheetData.push([item.item_name, item.quantity, item.unit_price, item.total_price]);
    }
    sheetData.push([]);
    sheetData.push(["Tổng tiền", "", "", order.total_amount]);

    const sheet = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(workbook, sheet, `Hóa đơn ${order.id}`);
  }

  XLSX.writeFile(workbook, filePath);
  return filePath;
};

// Hàm xuất báo cáo theo ngày
const generateReportForDate = async (date) => {
  console.log(`📥 Đang tổng hợp hóa đơn cho ngày ${date}`);
  const orders = await fetchOrders("o.order_date = ?", [date]);
  return generateExcelReport(orders, `./report_${date}.xlsx`);
};

async function generateCustomerReport(customerName, days) {
  // Tạo báo cáo cho khách hàng theo số ngày (ví dụ, gọi hàm generateReportForCustomer)
  const reportPath = await generateReportForCustomer(customerName, days);
  if (reportPath) {
    return reportPath;
  } else {
    return null;
  }
}
// Hàm xuất báo cáo theo khách hàng
const generateReportForCustomer = async (customerName, days) => {
  console.log(`📥 Đang tổng hợp hóa đơn cho khách hàng: ${customerName} trong ${days} ngày gần đây`);

  // Lấy ngày hiện tại và tính toán ngày bắt đầu
  const currentDate = new Date();
  const startDate = new Date(currentDate.setDate(currentDate.getDate() - days));

  // Định dạng ngày theo kiểu `yyyy-mm-dd` nếu cần
  const startDateString = startDate.toISOString().split("T")[0]; // "yyyy-mm-dd"

  // Lọc các đơn hàng theo tên khách hàng và ngày
  const orders = await fetchOrders("c.name = ? AND o.order_date >= ?", [customerName, startDateString]);

  if (!orders || orders.length === 0) {
    console.log("❌ Không có hóa đơn nào trong khoảng thời gian này.");
    return null;
  }

  // Tạo báo cáo Excel cho các đơn hàng
  return generateExcelReport(orders, `./report_customer_${customerName}_${days}_days.xlsx`);
};


// Hàm xuất báo cáo theo số ngày gần đây
const generateReportForDays = async (days) => {
  console.log(`📥 Đang tổng hợp hóa đơn trong ${days} ngày gần đây`);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  const formattedStartDate = startDate.toISOString().split("T")[0];

  const orders = await fetchOrders("o.order_date >= ?", [formattedStartDate]);
  return generateExcelReport(orders, `./report_${days}_days.xlsx`);
};

const generateAllReports = async () => {
  console.log(`📥 Đang tổng hợp tất cả hóa đơn`);

  const orders = await fetchOrders("1 = 1", []); // Không có điều kiện lọc ngày
  return generateExcelReport(orders, `./report_all.xlsx`);
};

// Hàm yêu cầu người dùng nhập số ngày
async function askForDays(chatId, customerName) {
  return new Promise((resolve) => {
    bot.sendMessage(chatId, `⏳ Vui lòng nhập số ngày (ví dụ: 3) để lấy báo cáo cho khách hàng ${customerName}:`)
      .then(() => {
        bot.once("message", (msg) => {
          const days = parseInt(msg.text.trim(), 10);
          if (isNaN(days)) {
            bot.sendMessage(chatId, "❌ Vui lòng nhập một số hợp lệ.");
            resolve(null);
          } else {
            resolve(days);
            bot.sendMessage(chatId, "📥 Đang tổng hợp dữ liệu.");
          }
        });
      });
  });
}
async function generateOrderItemReport(chatId, days) {
  const connection = await mysql.createConnection(dbConfig);

  try {
    // Tính ngày giới hạn
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);
    const formattedDate = dateLimit.toISOString().split("T")[0]; // yyyy-mm-dd

    // Truy vấn tổng hợp mặt hàng
    const [rows] = await connection.execute(
      `
      SELECT oi.item_name, 
             oi.unit_price,
             SUM(oi.quantity) AS total_quantity, 
             SUM(oi.total_price) AS total_price
      FROM Order_Items oi
      JOIN Orders o ON oi.order_id = o.id
      WHERE o.order_date >= ?
      GROUP BY oi.item_name, oi.unit_price
      ORDER BY total_quantity DESC
    `,
      [formattedDate]
    );

    if (rows.length === 0) {
      bot.sendMessage(chatId, "📭 Không có mặt hàng nào trong khoảng thời gian này.");
      return null;
    }

    // 📝 Log dữ liệu ra console
    // console.log("📌 Dữ liệu báo cáo mặt hàng:");
    // rows.forEach((row, index) => {
    //   console.log(
    //     `${index + 1}. ${row.item_name} - Đơn giá: ${row.unit_price} VND - Số lượng: ${row.total_quantity} - Tổng tiền: ${row.total_price} VND`
    //   );
    // });

    // Tạo workbook và worksheet
    const worksheetData = [
      ["Mặt hàng", "Đơn giá ( nghìn VND)", "Tổng số lượng", "Tổng giá trị ( .000 VND)"], // Tiêu đề cột
      ...rows.map((row) => [row.item_name, row.unit_price, row.total_quantity, row.total_price])
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Báo cáo mặt hàng");

    // Tạo file Excel
    const filePath = `./order_item_report_${formattedDate}.xlsx`;
    XLSX.writeFile(workbook, filePath);

    console.log(`📄 File báo cáo đã được tạo: ${filePath}`);

    // Gửi file báo cáo qua Telegram bot
    await bot.sendDocument(chatId, filePath, {
      caption: `📊 Báo cáo mặt hàng bán được trong ${days} ngày gần nhất.`,
    });

    // Xóa file sau khi gửi
    fs.unlinkSync(filePath);
    console.log(`🗑️ File đã được xóa sau khi gửi: ${filePath}`);
  } catch (error) {
    console.error("❌ Lỗi khi tạo báo cáo:", error);
    bot.sendMessage(chatId, "⚠️ Đã xảy ra lỗi khi tạo báo cáo.");
  } finally {
    await connection.end();
  }
}

// Lệnh xử lý "/cleardb"
bot.onText(/\/cleardb/, (msg) => {
  const chatId = msg.chat.id;

  // Gửi cảnh báo xác nhận trước khi xóa
  bot.sendMessage(chatId, "⚠️ Bạn có chắc chắn muốn xóa toàn bộ database? Hành động này không thể hoàn tác!", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Xóa ngay", callback_data: "confirm_clear_db" }],
        [{ text: "❌ Hủy", callback_data: "cancel_clear_db" }],
      ],
    },
  });
});

// Xử lý xác nhận từ người dùng
bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === "confirm_clear_db") {
    clearDatabase(chatId);
  } else if (data === "cancel_clear_db") {
    bot.sendMessage(chatId, "✅ Hủy bỏ thao tác xóa database.");
  }
});

// Hàm xóa dữ liệu
const clearDatabase = async (chatId) => {
  try {
    // Kết nối đến database
    const connection = await mysql.createConnection(dbConfig);

    const queries = [
      "DELETE FROM Order_Items;",
      "DELETE FROM Orders;",
      "DELETE FROM Customers;",
    ];

    // Thực thi tất cả các truy vấn một cách bất đồng bộ
    for (const query of queries) {
      await connection.execute(query);  // Chạy từng truy vấn
      console.log(`✅ Xóa dữ liệu thành công: ${query}`);
    }

    // Sau khi tất cả truy vấn đã hoàn tất
    bot.sendMessage(chatId, "✅ Database đã được xóa sạch!");

    // Đóng kết nối sau khi hoàn tất
    await connection.end();
  } catch (err) {
    console.error(`❌ Lỗi khi xóa dữ liệu: ${err.message}`);
    bot.sendMessage(chatId, "❌ Xóa dữ liệu thất bại.");
  }
};

// Hàm xóa dữ liệu
const deleteOrderById = async (chatId, orderId) => {
  try {
    if (!orderId || isNaN(orderId)) {
      bot.sendMessage(chatId, "⚠️ Vui lòng nhập ID hóa đơn hợp lệ.");
      console.error("❌ Lỗi: orderId không hợp lệ", orderId);
      return;
    }

    // Kết nối đến database
    const connection = await mysql.createConnection(dbConfig);

    // Xóa tất cả Order_Items trước để tránh lỗi khóa ngoại
    await connection.execute("DELETE FROM Order_Items WHERE order_id = ?", [orderId]);

    // Xóa hóa đơn sau khi xóa Order_Items
    const [result] = await connection.execute("DELETE FROM Orders WHERE id = ?", [orderId]);

    if (result.affectedRows > 0) {
      bot.sendMessage(chatId, `✅ Đã xóa hóa đơn ID: ${orderId} và các Order_Items liên quan.`);
    } else {
      bot.sendMessage(chatId, "⚠️ Không tìm thấy hóa đơn để xóa.");
    }

    // Đóng kết nối sau khi hoàn tất
    await connection.end();
  } catch (err) {
    console.error(`❌ Lỗi khi xóa dữ liệu: ${err.message}`);
    bot.sendMessage(chatId, "❌ Xóa dữ liệu thất bại.");
  }
};


const deleteOrderByCustomer = async (chatId) => {
  try {
    const connection = await mysql.createConnection(dbConfig);

    // Truy vấn danh sách khách hàng
    const [customers] = await connection.execute("SELECT id, name FROM Customers");

    if (customers.length === 0) {
      bot.sendMessage(chatId, "⚠️ Không có khách hàng nào.");
      return;
    }

    // Tạo các nút chọn khách hàng
    const customerButtons = customers.map((customer) => [
      { text: customer.name, callback_data: `select_customer_${customer.id}` }
    ]);

    const keyboard = { inline_keyboard: customerButtons };
    bot.sendMessage(chatId, "📌 Chọn khách hàng:", { reply_markup: keyboard });

    await connection.end();
  } catch (err) {
    console.error("❌ Lỗi truy vấn database:", err);
    bot.sendMessage(chatId, "❌ Lỗi truy vấn database.");
  }
};

// Xử lý khi chọn khách hàng để xem hóa đơn cần xóa
const deleteAllOrdersByCustomer = async (chatId, customerId) => {
  try {
    const connection = await mysql.createConnection(dbConfig);

    // Lấy danh sách order_id của khách hàng này
    const [orders] = await connection.execute(
      "SELECT id FROM Orders WHERE customer_id = ?",
      [customerId]
    );

    if (orders.length === 0) {
      bot.sendMessage(chatId, "⚠️ Khách hàng này không có hóa đơn để xóa.");
      return;
    }

    // Lấy danh sách ID đơn hàng
    const orderIds = orders.map(order => order.id);

    // Xóa Order_Items trước (vì có ràng buộc khóa ngoại)
    await connection.execute(
      `DELETE FROM Order_Items WHERE order_id IN (${orderIds.join(",")})`
    );

    // Xóa Orders
    await connection.execute(
      `DELETE FROM Orders WHERE id IN (${orderIds.join(",")})`
    );

    bot.sendMessage(chatId, `✅ Đã xóa ${orderIds.length} hóa đơn và tất cả mục liên quan.`);

    await connection.end();
  } catch (err) {
    console.error("❌ Lỗi khi xóa hóa đơn:", err);
    bot.sendMessage(chatId, "❌ Xóa hóa đơn thất bại.");
  }
};
