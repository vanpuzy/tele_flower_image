

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