

CREATE TABLE IF NOT EXISTS Customers
(
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255),
  address VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS Orders
(
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT,
  order_date  DATE,
  totalAmount INT,
  FOREIGN KEY (customer_id) REFERENCES Customers(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS Order_Items
(
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT,
  item_name VARCHAR(255),
  quantity INT NOT NULL,
  unit_price INT,
  total_price INT,
  FOREIGN KEY (order_id) REFERENCES Orders(id) ON DELETE CASCADE
);










