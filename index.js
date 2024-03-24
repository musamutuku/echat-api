const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
// const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const { expressjwt: ejwt } = require("express-jwt");
const bcrypt = require("bcrypt");
const { log } = require("console");
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// const pool = new Pool({
//   user: process.env.PG_USER,
//   host: process.env.PG_HOST,
//   database: process.env.PG_DATABASE,
//   password: process.env.PG_PASSWORD,
//   port: process.env.PG_PORT,
// });
const pool = require('./dbConfig');


app.use(express.json());
const connectedUsers = {};
const messages = [];
const JWT_SECRET = "your_secret_key";

io.setMaxListeners(50);

app.get("/", (req, res) => {
  res.send("welcome to chat api");
});

app.get("/users", (req, res) => {
  // Query the database using the connection pool
  pool.query("SELECT * FROM users", (error, result) => {
    if (error) {
      console.error("Error executing query", error);
      res.status(500).json({ error: "Internal Server Error" });
    } else {
      res.json(result.rows);
    }
  });
});

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
      return res.status(200).json({
        regMsg:
          "User registered successfully. Tap anywhere to proceed for login",
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error!" });
  }
});

const host = process.env.PG_HOST
const port = 3001
server.listen(3001, host, () => {
  console.log(`Server is running on http://${host}:${port}`);
});

io.on("connection", (socket) => {
  socket.on("connected", (newuser) => {
    console.log(newuser);
  });

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
          socket.emit("storedMessages", messages);
          // store user to connectedUsers store
          // connectedUsers[username] = {id:socket.id, username: username};
          if (!connectedUsers[username]) {
            // If not, create a new array to store socket IDs
            connectedUsers[username] = [];
          }
          // Push the current socket ID into the array
          connectedUsers[username].push(socket.id);
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
  socket.on("markAsRead", (receiver, sender) => {
    messages
      .filter(
        (msg) =>
          msg.recipientUsername == receiver &&
          msg.senderUsername == sender &&
          msg.mark == "unread"
      )
      .forEach((msg) => {
        msg.mark = "read";
      });
  });

  socket.on("deleteMsg", (receiver, sender) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (
        (messages[i].senderUsername == sender &&
          messages[i].recipientUsername == receiver) ||
        (messages[i].recipientUsername == sender &&
          messages[i].senderUsername == receiver)
      ) {
        messages.splice(i, 1);
      }
    }
  });

  socket.on("deleteMsg1", (msgDate) => {
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].date == msgDate) {
        messages.splice(i, 1);
      }
    }
  });

  socket.on(
    "sendMessage",
    async ({
      id,
      senderUsername,
      recipientUsername,
      message,
      time,
      mark,
      date,
    }) => {
      const newMessage = {
        id,
        senderUsername,
        recipientUsername,
        message: message,
        time,
        mark,
        date,
      };
      try {
        messages.push(newMessage);
        var totalUnread = 0;
        // Get the recipient's socket ID from the connectedUsers object
        const recipientSocketId = connectedUsers[recipientUsername];
        const unreadMsg = messages.filter(
          (msg) =>
            msg.recipientUsername === recipientUsername &&
            msg.senderUsername === senderUsername &&
            msg.mark === "unread"
        );
        for (let count = 0; count <= unreadMsg.length; count++) {
          totalUnread = count;
        }
        if (recipientSocketId) {
          // Emit the message only to the recipient
          io.to(recipientSocketId).emit("receiveMessage", {
            senderUsername,
            message: message,
            totalUnread,
            date,
          });
        } else {
          // Handle case when recipient is not connected
          console.log(`Recipient ${recipientUsername} is not connected`);
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
    }
  );
  socket.on("disconnect", () => {
    console.log(`User disconnected with socket ID: ${socket.id}`);
    // Remove the specific socket   ID associated with the disconnected socket from connectedUsers
    Object.keys(connectedUsers).forEach((username) => {
      connectedUsers[username] = connectedUsers[username].filter(
        (id) => id !== socket.id
      );
      // If there are no more socket IDs associated with the username, remove the username entry from connectedUsers
      if (connectedUsers[username].length === 0) {
        delete connectedUsers[username];
      }
    });
  });
});
