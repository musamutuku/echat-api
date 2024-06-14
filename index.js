const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
// const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const { expressjwt: ejwt } = require("express-jwt");
const bcrypt = require("bcrypt");
const { log } = require("console");
const dotenv = require("dotenv");
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
const pool = require("./dbConfig");

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
    // Check if the user with the provided username already exists in the database
    const userExists = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (userExists.rows.length > 0) {
      if (userExists.rows[0].verification == "verified") {
        return res.status(400).json({ regUserMsg: "User already registered!" });
      } else {
        return res.status(400).json({
          regUserMsg01:
            "User has a pending verification. Enter OTP send to your email or",
        });
      }
    } else {
      const otp = Math.floor(1000 + Math.random() * 9000); // Generate 4-digit OTP
      const result = await pool.query(
        "INSERT INTO users (username, email, password, OTP, verification) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [username, email, hashedPassword, otp, "pending"]
      );
      sendMail(email, otp)
        .then(() => {
          res.status(200).json({
            OTPmessage: "OTP has been send to your email for verification",
          });
          return res.status(200).json({
            regUserMsg01: `Enter OTP send to your email for verification`,
          });
        })
        .catch((error) => {
          console.log(error);
          // res.status(500).json({ error: "Internal Server Error!" });
          res
            .status(500)
            .json({
              OTPmessage1: "Failed to send OTP for verification. Try later!",
            });
        });
      // const registeredUser = result.rows[0];
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error!" });
  }
});

// OTP verification process
const bodyParser = require("body-parser");

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.post("/verify", async (req, res) => {
  const { otp, username } = req.body;
  try {
    // Check if the user with the provided username already exists in the database
    const userExists = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (userExists.rows.length > 0) {
      if (userExists.rows[0].otp == otp) {
        const query =
          "UPDATE users SET verification = $1 WHERE username = $2 RETURNING *";
        const values = ["verified", username];
        const result = await pool.query(query, values);
        if (result.rows.length > 0) {
          return res.status(200).json({
            regMsg:
              "User registered successfully. Tap anywhere to proceed for login",
          });
        }
      } else {
        return res.status(400).json({ regUserMsg02: "Incorrect OTP!" });
      }
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error!" });
  }
});

app.post("/resend-otp", async (req, res) => {
  const { username } = req.body;
  const otp = Math.floor(1000 + Math.random() * 9000); // Generate 4-digit OTP
  try {
    // Check if the user with the provided username already exists in the database
    const userExists = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (userExists.rows.length > 0) {
      const email = userExists.rows[0].email;
      sendMail(email, otp)
        .then(() => {
          res.status(200).json({ OTPmessage: "OTP has been resend to your email successfully" });
          const query =
            "UPDATE users SET otp = $1 WHERE username = $2 RETURNING *";
          const values = [otp, username];
          const result = pool.query(query, values);
          if (result.rows.length > 0) {
            return res.status(200).json({
              regUserMsg01: `New OTP has been resend to your Email. Check in the Email and enter it here`,
            });
          }
        })
        .catch((error) => {
          console.log(error);
          // res.status(500).json({ error: "Internal Server Error!" });
          res
            .status(500)
            .json({ OTPmessage1: "Failed to resend OTP. Try again later!" });
        });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error!" });
  }
});

const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
  service: "Gmail",
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.APP_MAIL,
    pass: process.env.MAIL_PASS,
  },
});

function sendMail(email, otp) {
  const mailOptions = {
    from: "eChat <musamutuku2020@gmail.com>",
    to: email,
    subject: "OTP Verification",
    text: `Your OTP is ${otp}`,
  };
  return transporter.sendMail(mailOptions);
}

function sendMail1(email, resetPassword) {
  const mailOptions = {
    from: "eChat <musamutuku2020@gmail.com>",
    to: email,
    subject: "Password Reset",
    text: `Your New Password is ${resetPassword}`,
  };
  return transporter.sendMail(mailOptions);
}

app.post("/reset", async (req, res) => {
  const { username, email } = req.body;
  const resetPassword = Math.floor(100000 + Math.random() * 900000).toString(); // Generate 6-digit Password
  const hashedPassword = await bcrypt.hash(resetPassword, 10);
  try {
    // Check if the user with the provided username already exists in the database
    const userExists = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (userExists.rows.length > 0) {
      if (userExists.rows[0].email == email) {
        sendMail1(email, resetPassword)
          .then(() => {
            res
              .status(200)
              .json({ OTPmessage: "New password has been send to your email" });
            const query =
              "UPDATE users SET password = $1 WHERE username = $2 RETURNING *";
            const values = [hashedPassword, username];
            const result = pool.query(query, values);
            if (result.rows.length > 0) {
              return res.status(200).json({
                resetSuccess:
                  "New password has been mailed to you. Use the password to login and change it.",
              });
            }
          })
          .catch((error) => {
            console.log(error);
            res
              .status(500)
              .json({ OTPmessage1: "Password mailing failed! Try again later" });
          });
      } else {
        return res.status(400).json({ resetError: "Invalid email address!" });
      }
    } else {
      return res.status(400).json({ resetError: "Username does not exist!" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error!" });
  }
});

app.post("/changepassword", async (req, res) => {
  const { username, pswd, newPassword } = req.body;
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  try {
    // Check if the user with the provided username already exists in the database
    const userExists = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (userExists.rows.length > 0) {
      const passwordMatch = await bcrypt.compare(pswd, userExists.rows[0].password);
      if(passwordMatch){
        const query = "UPDATE users SET password = $1 WHERE username = $2 RETURNING *";
        const values = [hashedPassword, username];
        const result = pool.query(query, values);
        return res.status(200).json({ pswdMessage: "Password has been changed successfully"});
      }
      else{
        return res.status(400).json({ pswdMessage1: "The current password you entered is incorrect" });
      }
    } else {
      return res.status(400).json({ pswdMessage1: "Login session has expired. Refresh and login again" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error!" });
  }
});


app.post("/deleteAccount", async (req, res) => {
  const { username, pswd1 } = req.body;
  try {
    // Check if the user with the provided username already exists in the database
    const userExists = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (userExists.rows.length > 0) {
      const passwordMatch = await bcrypt.compare(pswd1, userExists.rows[0].password);
      if(passwordMatch){
        const query = "DELETE FROM users WHERE username = $1";
        const value = [username];
        const result = pool.query(query, value);
        return res.status(200).json({ pswdMessage: "Account has been deleted successfully"});
      }
      else{
        return res.status(400).json({ pswdMessage1: "The password you entered is incorrect. Try again!" });
      }
    } else {
      return res.status(400).json({ pswdMessage1: "Login session has expired. Refresh and login again" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error!" });
  }
});


// uploading image
const multer  = require('multer');
const path = require('path');
   //set up storage engine
const storage = multer.diskStorage({
  destination: './uploads',
  filename: (req, file, cb) =>{
    cb(null, `${Date.now()}-${file.originalname}`)
  },
})

const upload = multer({storage})
  //serve static files
app.use('/uploads', express.static(path.join(__dirname,'uploads')))
  //file upload endpoint
app.post('/upload',upload.single('image'), async (req,res) =>{
  const { filename } = req.file;
  const { username } = req.body;
  try{
    const userExists = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (userExists.rows.length > 0) {
      const client = await pool.connect();
      const query = 'UPDATE users SET profile_image = $1 WHERE username = $2 RETURNING profile_image'
      const values = [filename,username]
      const result = await client.query(query, values)
      client.release()
      res.json({filename: result.rows[0].profile_image})
    } else {
      res.status(500).json({error: 'Internal server error'})
    }
  } catch (error){
    res.status(500).json({error: 'Internal server error'})
  }
})



const host = process.env.HOST;
const port = process.env.PORT;
server.listen(port, host, () => {
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
          if (user.verification != "verified") {
            socket.emit("loginUnverified", user, {
              regUserMsg01:
                "User has a pending verification. Enter OTP send to your email or",
            });
          } else {
            socket.emit("loginSuccess", user, token);
          }
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
            message: "Invalid password!",
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
