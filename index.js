const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const XLSX = require("xlsx");

TELEGRAM_BOT_DAT_TOKEN="7730662102:AAGqaftCXkjvX8QpDAJvtFpqvR59z6AfYJU"
BOT_TOKEN = TELEGRAM_BOT_DAT_TOKEN
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// API URL nhận file
const apiUrl = "http://222.255.250.26:8090/extract_bill_info/";

console.log(" bot dang chay")
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

    // Sheet 2: Danh sách hàng hóa
    const headers = ["Thứ tự", "Tên mặt hàng", "Số lượng", "Đơn giá", "Thành tiền"];
    const dataRows = jsonData["Thông tin"].map(item => [
      item["thứ tự"], item["tên mặt hàng"], item["số lượng"], item["đơn giá"], item["thành tiền"]
    ]);
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
