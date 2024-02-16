const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const { expressjwt: ejwt } = require("express-jwt");
const bcrypt = require("bcrypt");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "echat",
  password: "musa",
  port: 5432,
});

app.use(express.json());
const connectedUsers = {};
const messages = [];
const JWT_SECRET = "your_secret_key";

app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    // Check if the user with the provided ID already exists in the database
    const userExists = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (userExists.rows.length > 0) {
      return res.status(400).json({ regUserMsg: "User already registered!" });
    } else {
      const result = await pool.query(
        "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *",
        [username, email, hashedPassword]
      );
      // const registeredUser = result.rows[0];
      return res
        .status(200)
        .json({
          regMsg:
            "User registered successfully. Tap anywhere to proceed for login",
        });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error!" });
  }
});

server.listen(3001, "0.0.0.0", () => {
  console.log("Server is running on http://0.0.0.0:3001");
});

io.on("connection", (socket) => {
  console.log(`User connected with socket ID: ${socket.id}`);

  socket.on("login", async ({ username, password }) => {
    try {
      const result = await pool.query(
        "SELECT * FROM users WHERE username = $1",
        [username]
      );
      const user = result.rows[0];
      if (user) {
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (passwordMatch) {
          const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "1h" });
          socket.emit("loginSuccess", user, token);
          console.log(messages);
          // const userMessage = messages.filter((msg) => (msg.recipientUsername === user.username || msg.senderUsername === user.username))
          socket.emit("storedMessages", messages);
          // store user to connectedUsers store
          connectedUsers[username] = socket.id;
        } else {
          socket.emit("loginFailure", {
            message: "Invalid username or password!",
          });
        }
      } else {
        socket.emit("loginFailure", {
          message: "User not found. Please register!",
        });
      }
    } catch (error) {
      console.error(error);
      socket.emit("loginFailure", {
        message: "Internal Server Error!",
      });
    }

    // Middleware to protect routes requiring authentication
    // const authenticateJWT = ejwt({ secret: JWT_SECRET, algorithms: ["HS256"] });
    // app.get('/protected', authenticateJWT, (req, res) => {
    //   res.json({ message: 'Protected route accessed successfully!' });
    // });
  });

  socket.on(
    "sendMessage",
    async ({ senderUsername, recipientUsername, message }) => {
      const newMessage = {
        senderUsername,
        recipientUsername,
        message: message
      };
      try {
        // Get the recipient's socket ID from the connectedUsers object
        const recipientSocketId = connectedUsers[recipientUsername];
        if (recipientSocketId) {
          // Emit the message only to the recipient
          io.to(recipientSocketId).emit("receiveMessage", {
            senderUsername,
            message: message,
          });
          messages.push(newMessage);
          // console.log(messages);
          // messages.push(newMessage);
        } else {
          // Handle case when recipient is not connected
          console.log(`Recipient ${recipientUsername} is not connected`);
          messages.push(newMessage);
        }
      } catch (error) {
        console.error(error);
      }

      //Broadcast to all connected users
      // socket.on('sendMessage', async ({ senderId, recipientId, message }) => {
      //   try {
      //     io.emit('receiveMessage', { senderId, recipientId, message });
      //   } catch (error) {
      //     console.error(error);
      //   }
      // });

      socket.on("disconnect", () => {
        // Remove the user's entry from connectedUsers on disconnect
        const userId = Object.keys(connectedUsers).find(
          (key) => connectedUsers[key] === socket.id
        );
        if (userId) {
          delete connectedUsers[userId];
        }

        console.log(`User disconnected with socket ID: ${socket.id}`);
      });
    }
  );
});
