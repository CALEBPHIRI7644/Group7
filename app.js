const express = require("express");
const app = express();
const mysql2 = require("mysql2");
const session = require("express-session");
const bcrypt = require("bcrypt");

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());
app.set("view engine", "ejs");

// MySQL connection pool
const pool = mysql2.createPool({
  host: "localhost",
  user: "root",
  database: "shopping",
  password: "",
});

// Express session
app.use(
  session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
  })
);

// Middleware to check roles
function requireRole(role) {
  return (req, res, next) => {
    if (req.session.user && req.session.user.role === role) {
      return next();
    }
    return res.status(403).send("Access denied");
  };
}

// ROUTES

// Landing Page - Public route
app.get("/", async (req, res) => {
  try {
    const [latestProducts] = await pool
      .promise()
      .query(
        "SELECT * FROM products WHERE quantity > 0 ORDER BY id DESC LIMIT 4"
      );

    const [allProducts] = await pool
      .promise()
      .query("SELECT * FROM products ORDER BY id DESC");

    res.render("landing_page", {
      latestProducts,
      allProducts,
    });
  } catch (err) {
    console.error("Error loading landing page:", err);
    res.send("Error loading page");
  }
});

// Registration
app.get("/register1", (req, res) => {
  res.render("register1");
});

app.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.send("All fields are required");
  }

  try {
    const [results] = await pool
      .promise()
      .query("SELECT * FROM users WHERE email=?", [email]);
    if (results.length) return res.send("Email already registered");

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool
      .promise()
      .query(
        "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
        [name, email, hashedPassword, role]
      );
    res.redirect("/login");
  } catch (err) {
    console.error("Insert error:", err);
    res.send("Error registering user: " + err.message);
  }
});

// LOGIN
app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const [results] = await pool
      .promise()
      .query("SELECT * FROM users WHERE email=?", [email]);
    if (!results.length) return res.send("User not found");

    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.send("Invalid password");

    req.session.user = user;

    if (user.role === "admin") return res.redirect("/admin/dashboard");
    if (user.role === "seller") return res.redirect("/seller/dashboard");
    if (user.role === "customer") return res.redirect("/customer/dashboard");

    res.send("Role not recognized");
  } catch (err) {
    res.send("DB error");
  }
});

// LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// ADMIN ROUTES
app.get("/admin/dashboard", requireRole("admin"), async (req, res) => {
  try {
    const [salesResult] = await pool
      .promise()
      .query("SELECT COALESCE(SUM(total), 0) AS totalSales FROM orders");

    const [ordersResult] = await pool
      .promise()
      .query("SELECT COUNT(*) AS totalOrders FROM orders");

    const [pendingResult] = await pool
      .promise()
      .query(
        "SELECT COUNT(*) AS pendingOrders FROM orders WHERE status = 'Pending'"
      );

    const [deliveredResult] = await pool
      .promise()
      .query(
        "SELECT COUNT(*) AS deliveredOrders FROM orders WHERE status = 'Delivered'"
      );

    const [productsResult] = await pool
      .promise()
      .query("SELECT COUNT(*) AS totalProducts FROM products");

    const [customersResult] = await pool
      .promise()
      .query(
        "SELECT COUNT(*) AS totalCustomers FROM users WHERE role = 'customer'"
      );

    const [sellersResult] = await pool
      .promise()
      .query(
        "SELECT COUNT(*) AS totalSellers FROM users WHERE role = 'seller'"
      );

    const [recentOrders] = await pool.promise().query(`
        SELECT o.id, o.total, o.status,
               u.name AS customer
        FROM orders o
        LEFT JOIN users u ON o.customer_id = u.id
        ORDER BY o.id DESC
        LIMIT 10
      `);

    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const charts = {
      labels: months,
      salesSeries: [
        1200, 1900, 3000, 5000, 2300, 3200, 4100, 3800, 4500, 5200, 6000, 7200,
      ],
      customerSeries: [45, 52, 49, 60, 58, 65, 70, 68, 75, 80, 85, 90],
    };

    const cards = {
      totalSales: salesResult[0].totalSales || 0,
      totalOrders: ordersResult[0].totalOrders || 0,
      pendingOrders: pendingResult[0].pendingOrders || 0,
      deliveredOrders: deliveredResult[0].deliveredOrders || 0,
      totalProducts: productsResult[0].totalProducts || 0,
      totalCustomers: customersResult[0].totalCustomers || 0,
      totalSellers: sellersResult[0].totalSellers || 0,
    };

    res.render("admin_dashboard", {
      user: req.session.user,
      cards: cards,
      recentOrders: recentOrders,
      charts: charts,
    });
  } catch (err) {
    console.error("Error loading admin dashboard:", err);
    res.send("Error loading dashboard: " + err.message);
  }
});

app.get("/admin/products", requireRole("admin"), (req, res) => {
  pool.query(
    `SELECT p.*, 
            u.email AS seller_email,
            u.name AS seller_name
     FROM products p 
     LEFT JOIN users u ON p.seller_id=u.id`,
    (err, results) => {
      if (err) return res.send("Error fetching products");
      res.render("admin_products", {
        products: results,
        user: req.session.user,
      });
    }
  );
});

app.get("/admin/orders", requireRole("admin"), (req, res) => {
  pool.query("SELECT * FROM orders", (err, results) => {
    if (err) return res.send("Error fetching orders");
    res.render("admin_orders", {
      orders: results,
      user: req.session.user,
    });
  });
});

app.get("/admin/users", requireRole("admin"), async (req, res) => {
  try {
    const [users] = await pool
      .promise()
      .query("SELECT id, name, email, role FROM users ORDER BY id DESC");

    const [customerCount] = await pool
      .promise()
      .query("SELECT COUNT(*) AS count FROM users WHERE role = 'customer'");

    const [sellerCount] = await pool
      .promise()
      .query("SELECT COUNT(*) AS count FROM users WHERE role = 'seller'");

    const [adminCount] = await pool
      .promise()
      .query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");

    res.render("admin_manage_user", {
      user: req.session.user,
      users: users,
      totalCustomers: customerCount[0].count,
      totalSellers: sellerCount[0].count,
      totalAdmins: adminCount[0].count,
    });
  } catch (err) {
    console.error("Error loading manage users:", err);
    res.send("Error loading page: " + err.message);
  }
});

app.post("/admin/users/add", requireRole("admin"), async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.redirect("/admin/users?error=All fields are required");
  }

  try {
    const [existing] = await pool
      .promise()
      .query("SELECT * FROM users WHERE email = ?", [email]);

    if (existing.length > 0) {
      return res.redirect("/admin/users?error=Email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool
      .promise()
      .query(
        "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
        [name, email, hashedPassword, role]
      );

    res.redirect("/admin/users?success=User added successfully");
  } catch (err) {
    console.error("Error adding user:", err);
    res.redirect("/admin/users?error=" + err.message);
  }
});

app.post("/admin/users/delete", requireRole("admin"), async (req, res) => {
  const { user_id } = req.body;

  try {
    await pool.promise().query("DELETE FROM users WHERE id = ?", [user_id]);
    res.redirect("/admin/users?success=User deleted successfully");
  } catch (err) {
    console.error("Error deleting user:", err);
    res.redirect("/admin/users?error=" + err.message);
  }
});

app.get(
  "/admin/products/admin_add_product",
  requireRole("admin"),
  async (req, res) => {
    try {
      const [users] = await pool
        .promise()
        .query("SELECT id, name, email, role FROM users");
      res.render("admin_add_product", {
        users,
        user: req.session.user,
      });
    } catch (err) {
      console.error(err);
      res.send("Error loading users");
    }
  }
);

app.post(
  "/admin/products/admin_add_product",
  requireRole("admin"),
  (req, res) => {
    const { name, price, quantity, seller_id, image } = req.body;

    if (!name || !price || !quantity || !seller_id) {
      return res.send("Name, price, quantity, and seller are required");
    }

    pool.query(
      "INSERT INTO products (name, price, quantity, seller_id, image) VALUES (?, ?, ?, ?, ?)",
      [name, price, quantity, seller_id, image || null],
      (err) => {
        if (err) return res.send("Error adding product: " + err.message);
        res.redirect("/admin/products");
      }
    );
  }
);

// Customer Dashboard
app.get("/customer/dashboard", requireRole("customer"), async (req, res) => {
  try {
    const customerId = req.session.user.id;

    const [orders] = await pool
      .promise()
      .query("SELECT * FROM orders WHERE customer_id = ?", [customerId]);

    const totalOrders = orders.length;
    const pendingOrders = orders.filter((o) => o.status === "Pending").length;
    const deliveredOrders = orders.filter(
      (o) => o.status === "Delivered"
    ).length;
    const totalSpent = orders.reduce(
      (sum, order) => sum + parseFloat(order.total),
      0
    );

    const [products] = await pool
      .promise()
      .query("SELECT * FROM products WHERE quantity > 0 LIMIT 8");

    const [savedCart] = await pool
      .promise()
      .query("SELECT * FROM saved_carts WHERE customer_id = ?", [customerId]);

    res.render("customer_dashboard", {
      user: req.session.user,
      totalOrders,
      pendingOrders,
      deliveredOrders,
      totalSpent,
      products,
      hasSavedCart: savedCart.length > 0,
      currentPage: "dashboard",
      searchQuery: "",
      sortBy: "newest",
      minPrice: "",
      maxPrice: "",
    });
  } catch (err) {
    console.error("Error loading dashboard:", err);
    res.send("Error loading dashboard: " + err.message);
  }
});

// Browse Products with Search and Filters - FIXED IMAGE HANDLING
app.get("/customer/browse", requireRole("customer"), async (req, res) => {
  try {
    const searchQuery = req.query.search || "";
    const sortBy = req.query.sort || "newest";
    const minPrice = parseFloat(req.query.min_price) || 0;
    const maxPrice = parseFloat(req.query.max_price) || 999999;

    let query =
      "SELECT id, name, price, quantity, image, seller_id FROM products WHERE quantity > 0";
    const params = [];

    if (searchQuery) {
      query += " AND name LIKE ?";
      params.push(`%${searchQuery}%`);
    }

    query += " AND price >= ? AND price <= ?";
    params.push(minPrice, maxPrice);

    switch (sortBy) {
      case "price_low":
        query += " ORDER BY price ASC";
        break;
      case "price_high":
        query += " ORDER BY price DESC";
        break;
      case "name":
        query += " ORDER BY name ASC";
        break;
      case "newest":
      default:
        query += " ORDER BY id DESC";
        break;
    }

    const [products] = await pool.promise().query(query, params);

    // Log products to debug
    console.log("Products fetched:", products);

    const [savedCart] = await pool
      .promise()
      .query("SELECT * FROM saved_carts WHERE customer_id = ?", [
        req.session.user.id,
      ]);

    res.render("customer_browse", {
      products,
      searchQuery,
      sortBy,
      minPrice: minPrice || "",
      maxPrice: maxPrice === 999999 ? "" : maxPrice,
      user: req.session.user,
      hasSavedCart: savedCart.length > 0,
      currentPage: "browse",
    });
  } catch (err) {
    console.error("Error browsing products:", err);
    res.send("Error loading products: " + err.message);
  }
});

// Quick search API endpoint
app.get("/api/search", requireRole("customer"), async (req, res) => {
  try {
    const query = req.query.q || "";
    if (query.length < 2) {
      return res.json([]);
    }

    const [results] = await pool
      .promise()
      .query(
        "SELECT id, name, price FROM products WHERE name LIKE ? AND quantity > 0 LIMIT 10",
        [`%${query}%`]
      );

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Search failed" });
  }
});

// Customer Cart
app.get("/customer/cart", requireRole("customer"), async (req, res) => {
  const message = req.query.message || null;

  try {
    const [savedCart] = await pool
      .promise()
      .query("SELECT * FROM saved_carts WHERE customer_id = ?", [
        req.session.user.id,
      ]);

    if (!req.session.cart || req.session.cart.length === 0) {
      return res.render("customer_cart", {
        products: [],
        message: message || "Cart is empty",
        user: req.session.user,
        hasSavedCart: savedCart.length > 0,
        currentPage: "cart",
      });
    }

    const ids = req.session.cart.map((item) => item.product_id);
    const [products] = await pool
      .promise()
      .query(`SELECT * FROM products WHERE id IN (${ids.join(",")})`);

    const cartProducts = products.map((prod) => {
      const item = req.session.cart.find((i) => i.product_id === prod.id);
      return { ...prod, quantity_in_cart: item.quantity };
    });

    res.render("customer_cart", {
      products: cartProducts,
      message,
      user: req.session.user,
      hasSavedCart: savedCart.length > 0,
      currentPage: "cart",
    });
  } catch (err) {
    res.send("Error loading cart: " + err.message);
  }
});

app.post("/customer/cart/save", requireRole("customer"), async (req, res) => {
  if (!req.session.cart || req.session.cart.length === 0) {
    return res.redirect("/customer/cart?message=Cart is empty");
  }

  try {
    const customerId = req.session.user.id;
    const cartData = JSON.stringify(req.session.cart);

    const [existing] = await pool
      .promise()
      .query("SELECT * FROM saved_carts WHERE customer_id = ?", [customerId]);

    if (existing.length > 0) {
      await pool
        .promise()
        .query(
          "UPDATE saved_carts SET cart_data = ?, updated_at = NOW() WHERE customer_id = ?",
          [cartData, customerId]
        );
    } else {
      await pool
        .promise()
        .query(
          "INSERT INTO saved_carts (customer_id, cart_data) VALUES (?, ?)",
          [customerId, cartData]
        );
    }

    res.redirect("/customer/cart?message=Cart saved successfully");
  } catch (err) {
    console.error("Error saving cart:", err);
    res.send("Error saving cart: " + err.message);
  }
});

app.post("/customer/cart/load", requireRole("customer"), async (req, res) => {
  try {
    const customerId = req.session.user.id;

    const [results] = await pool
      .promise()
      .query("SELECT cart_data FROM saved_carts WHERE customer_id = ?", [
        customerId,
      ]);

    if (results.length === 0) {
      return res.redirect("/customer/cart?message=No saved cart found");
    }

    req.session.cart = JSON.parse(results[0].cart_data);
    res.redirect("/customer/cart?message=Cart loaded successfully");
  } catch (err) {
    console.error("Error loading cart:", err);
    res.send("Error loading cart: " + err.message);
  }
});

app.post(
  "/customer/cart/delete-saved",
  requireRole("customer"),
  async (req, res) => {
    try {
      const customerId = req.session.user.id;

      await pool
        .promise()
        .query("DELETE FROM saved_carts WHERE customer_id = ?", [customerId]);

      res.redirect("/customer/cart?message=Saved cart deleted");
    } catch (err) {
      console.error("Error deleting saved cart:", err);
      res.send("Error deleting saved cart: " + err.message);
    }
  }
);

app.post("/customer/cart/add", requireRole("customer"), (req, res) => {
  const { product_id, quantity } = req.body;
  if (!req.session.cart) req.session.cart = [];

  const existsIndex = req.session.cart.findIndex(
    (item) => item.product_id == product_id
  );

  if (existsIndex >= 0) {
    req.session.cart[existsIndex].quantity += parseInt(quantity);
  } else {
    req.session.cart.push({
      product_id: parseInt(product_id),
      quantity: parseInt(quantity),
    });
  }
  res.redirect("/customer/cart");
});

app.post("/customer/cart/remove", requireRole("customer"), (req, res) => {
  const { product_id } = req.body;
  if (!req.session.cart) req.session.cart = [];

  req.session.cart = req.session.cart.filter(
    (item) => item.product_id != product_id
  );

  res.redirect("/customer/cart");
});

app.post("/customer/cart/update", requireRole("customer"), (req, res) => {
  const { product_id, quantity } = req.body;
  if (!req.session.cart) req.session.cart = [];

  const itemIndex = req.session.cart.findIndex(
    (item) => item.product_id == product_id
  );
  if (itemIndex >= 0) {
    req.session.cart[itemIndex].quantity = parseInt(quantity);
  }

  res.redirect("/customer/cart");
});

app.post(
  "/customer/cart/checkout",
  requireRole("customer"),
  async (req, res) => {
    if (!req.session.cart || req.session.cart.length === 0) {
      return res.send("Cart is empty");
    }

    const connection = await pool.promise().getConnection();
    try {
      await connection.beginTransaction();

      let totalPrice = 0;
      for (const item of req.session.cart) {
        const [productRows] = await connection.query(
          "SELECT * FROM products WHERE id = ? FOR UPDATE",
          [item.product_id]
        );

        if (!productRows.length || productRows[0].quantity < item.quantity) {
          throw new Error(
            "Insufficient stock for product ID: " + item.product_id
          );
        }

        totalPrice += productRows[0].price * item.quantity;
      }

      const [orderResult] = await connection.query(
        "INSERT INTO orders (customer_id, total, status) VALUES (?, ?, ?)",
        [req.session.user.id, totalPrice, "Pending"]
      );

      for (const item of req.session.cart) {
        const [productRows] = await connection.query(
          "SELECT * FROM products WHERE id = ?",
          [item.product_id]
        );

        await connection.query(
          "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
          [
            orderResult.insertId,
            item.product_id,
            item.quantity,
            productRows[0].price,
          ]
        );

        await connection.query(
          "UPDATE products SET quantity = quantity - ? WHERE id = ?",
          [item.quantity, item.product_id]
        );
      }

      await connection.commit();
      req.session.cart = [];
      res.redirect("/customer/orders?message=Order placed successfully");
    } catch (err) {
      await connection.rollback();
      res.send("Error placing order: " + err.message);
    } finally {
      connection.release();
    }
  }
);

app.get("/customer/orders", requireRole("customer"), (req, res) => {
  const customerId = req.session.user.id;
  const message = req.query.message || null;

  pool.query(
    `SELECT o.id AS order_id, o.total, o.status, 
            oi.product_id, oi.quantity, oi.price, p.name AS product_name
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id
     JOIN products p ON oi.product_id = p.id
     WHERE o.customer_id = ?`,
    [customerId],
    (err, results) => {
      if (err) return res.send("Error fetching orders: " + err.message);

      const orders = {};
      results.forEach((row) => {
        if (!orders[row.order_id]) {
          orders[row.order_id] = {
            id: row.order_id,
            total: row.total,
            status: row.status,
            items: [],
          };
        }
        orders[row.order_id].items.push({
          product_id: row.product_id,
          name: row.product_name,
          quantity: row.quantity,
          price: row.price,
        });
      });

      res.render("customer_orders", {
        orders: Object.values(orders),
        message,
        user: req.session.user,
        currentPage: "orders",
      });
    }
  );
});

app.post(
  "/customer/orders/cancel",
  requireRole("customer"),
  async (req, res) => {
    const { order_id } = req.body;
    const connection = await pool.promise().getConnection();

    try {
      await connection.beginTransaction();

      await connection.query("DELETE FROM order_items WHERE order_id = ?", [
        order_id,
      ]);

      await connection.query("DELETE FROM orders WHERE id = ?", [order_id]);

      await connection.commit();
      res.redirect("/customer/orders?message=Order cancelled successfully");
    } catch (err) {
      await connection.rollback();
      res.send("Error cancelling order: " + err.message);
    } finally {
      connection.release();
    }
  }
);

// SELLER ROUTES
app.get("/seller/dashboard", requireRole("seller"), async (req, res) => {
  try {
    const sellerId = req.session.user.id;

    const [productsCount] = await pool
      .promise()
      .query("SELECT COUNT(*) AS count FROM products WHERE seller_id = ?", [
        sellerId,
      ]);

    const [ordersCount] = await pool.promise().query(
      `SELECT COUNT(DISTINCT o.id) AS count 
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE p.seller_id = ?`,
      [sellerId]
    );

    const [pendingCount] = await pool.promise().query(
      `SELECT COUNT(DISTINCT o.id) AS count 
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE p.seller_id = ? AND o.status = 'Pending'`,
      [sellerId]
    );

    const [revenueResult] = await pool.promise().query(
      `SELECT COALESCE(SUM(oi.price * oi.quantity), 0) AS revenue
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE p.seller_id = ?`,
      [sellerId]
    );

    const stats = {
      totalProducts: productsCount[0].count,
      totalOrders: ordersCount[0].count,
      pendingOrders: pendingCount[0].count,
      totalRevenue: parseFloat(revenueResult[0].revenue) || 0,
    };

    res.render("seller_dashboard", {
      user: req.session.user,
      stats: stats,
    });
  } catch (err) {
    console.error("Error loading seller dashboard:", err);
    res.send("Error loading dashboard: " + err.message);
  }
});

app.get("/seller/products", requireRole("seller"), (req, res) => {
  pool.query(
    "SELECT * FROM products WHERE seller_id=? ORDER BY id DESC",
    [req.session.user.id],
    (err, results) => {
      if (err) return res.send("Error fetching products");
      res.render("seller_products", {
        products: results,
        user: req.session.user,
      });
    }
  );
});

app.get("/seller/products/add", requireRole("seller"), (req, res) => {
  res.render("seller_add_product", { user: req.session.user });
});

app.post("/seller/products/add", requireRole("seller"), (req, res) => {
  const { name, price, quantity, image } = req.body;
  const seller_id = req.session.user.id;

  if (!name || !price || !quantity) {
    return res.send("Name, price, and quantity are required");
  }

  pool.query(
    "INSERT INTO products (name, price, quantity, seller_id, image) VALUES (?, ?, ?, ?, ?)",
    [name, price, quantity, seller_id, image || null],
    (err) => {
      if (err) return res.send("Error adding product: " + err.message);
      res.redirect("/seller/products");
    }
  );
});

app.get(
  "/seller/products/edit/:id",
  requireRole("seller"),
  async (req, res) => {
    try {
      const [products] = await pool
        .promise()
        .query("SELECT * FROM products WHERE id = ? AND seller_id = ?", [
          req.params.id,
          req.session.user.id,
        ]);

      if (products.length === 0) {
        return res.send("Product not found or access denied");
      }

      res.render("seller_edit_product", {
        product: products[0],
        user: req.session.user,
      });
    } catch (err) {
      res.send("Error loading product: " + err.message);
    }
  }
);

app.post(
  "/seller/products/edit/:id",
  requireRole("seller"),
  async (req, res) => {
    const { name, price, quantity, image } = req.body;

    try {
      await pool
        .promise()
        .query(
          "UPDATE products SET name = ?, price = ?, quantity = ?, image = ? WHERE id = ? AND seller_id = ?",
          [
            name,
            price,
            quantity,
            image || null,
            req.params.id,
            req.session.user.id,
          ]
        );

      res.redirect("/seller/products");
    } catch (err) {
      res.send("Error updating product: " + err.message);
    }
  }
);

app.post("/seller/products/delete", requireRole("seller"), async (req, res) => {
  const { product_id } = req.body;

  try {
    await pool
      .promise()
      .query("DELETE FROM products WHERE id = ? AND seller_id = ?", [
        product_id,
        req.session.user.id,
      ]);

    res.redirect("/seller/products");
  } catch (err) {
    res.send("Error deleting product: " + err.message);
  }
});

app.get("/seller/orders", requireRole("seller"), async (req, res) => {
  const sellerId = req.session.user.id;
  const message = req.query.message || null;

  try {
    const [results] = await pool.promise().query(
      `SELECT o.id AS order_id, o.total, o.status, 
              oi.product_id,oi.quantity, oi.price, p.name
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE p.seller_id = ?
       ORDER BY o.id DESC`,
      [sellerId]
    );

    const orders = {};
    results.forEach((row) => {
      if (!orders[row.order_id]) {
        orders[row.order_id] = {
          id: row.order_id,
          total: row.total,
          status: row.status,
          items: [],
        };
      }
      orders[row.order_id].items.push({
        product_id: row.product_id,
        name: row.name,
        quantity: row.quantity,
        price: row.price,
      });
    });

    res.render("seller_orders", {
      orders: Object.values(orders),
      user: req.session.user,
      message: message,
    });
  } catch (err) {
    res.send("Error fetching orders: " + err.message);
  }
});

app.post(
  "/seller/orders/update-status",
  requireRole("seller"),
  async (req, res) => {
    const { order_id, status } = req.body;

    try {
      await pool
        .promise()
        .query("UPDATE orders SET status = ? WHERE id = ?", [status, order_id]);

      res.redirect("/seller/orders?message=Order status updated successfully");
    } catch (err) {
      res.send("Error updating order: " + err.message);
    }
  }
);

app.post("/seller/orders/reject", requireRole("seller"), async (req, res) => {
  const { order_id } = req.body;
  const connection = await pool.promise().getConnection();

  try {
    await connection.beginTransaction();

    const [orderItems] = await connection.query(
      "SELECT product_id, quantity FROM order_items WHERE order_id = ?",
      [order_id]
    );

    for (const item of orderItems) {
      await connection.query(
        "UPDATE products SET quantity = quantity + ? WHERE id = ?",
        [item.quantity, item.product_id]
      );
    }

    await connection.query("DELETE FROM order_items WHERE order_id = ?", [
      order_id,
    ]);

    await connection.query("DELETE FROM orders WHERE id = ?", [order_id]);

    await connection.commit();
    res.redirect("/seller/orders?message=Order rejected and stock restored");
  } catch (err) {
    await connection.rollback();
    res.send("Error rejecting order: " + err.message);
  } finally {
    connection.release();
  }
});

// SERVER
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at: http://localhost:${PORT}`);
});
