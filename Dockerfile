FROM node:18-alpine

# Thư mục làm việc
WORKDIR /app

# Copy mã nguồn vào Docker image
COPY . /app

# Cài đặt dependencies
RUN npm install --omit=dev

# Chạy ứng dụng
CMD ["node", "index.js"]  # Thay thế index.js bằng file chính của bạn
