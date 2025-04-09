# Sử dụng Node.js 18 trên Alpine Linux (nhẹ, tối ưu)
FROM node:18-alpine

# Đặt thư mục làm việc trong container
WORKDIR /app

# Sao chép toàn bộ project vào container
COPY . .

# Cài đặt các dependencies (bỏ qua devDependencies)
RUN npm install --omit=dev

# Chạy ứng dụng
CMD ["node", "index.js"]
