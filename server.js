const express = require("express");
const path = require("path");
const multer = require("multer");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const PORT = 3000;
const server = http.createServer(app);
const io = new Server(server);

// MongoDB connection
const MONGO_URI = "mongodb://localhost:27017/lan_chat";
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Define a schema for storing file information
const fileSchema = new mongoose.Schema({
  filename: String,
  path: String,
  size: Number,
  hash: String, // To check for duplicates
  uploadDate: { type: Date, default: Date.now },
});
const File = mongoose.model("File", fileSchema);

// Middleware
app.use(express.static(path.resolve(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage: storage });

// Serve the chat page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Handle file uploads
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const fileHash = req.file.filename; // Use filename as a simple hash for deduplication

    // Check if the file already exists in the database
    const existingFile = await File.findOne({ hash: fileHash });
    if (existingFile) {
      console.log("File already exists in the database:", existingFile);

      // Notify all connected clients about the existing file
      io.emit("file-shared", {
        filename: existingFile.filename,
        path: `/uploads/${existingFile.filename}`,
        size: existingFile.size,
      });

      return res
        .status(200)
        .json({ message: "File already exists", file: existingFile });
    }

    // Save file information to MongoDB
    const file = new File({
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      hash: fileHash,
    });
    await file.save();

    console.log("File information saved to database:", file);

    // Notify all connected clients about the new file
    io.emit("file-shared", {
      filename: file.filename,
      path: `/uploads/${file.filename}`,
      size: file.size,
    });

    return res
      .status(200)
      .json({ message: "File uploaded successfully", file });
  } catch (err) {
    console.error("Error saving file to database:", err);
    return res.status(500).send("Internal Server Error");
  }
});

// Handle WebSocket connections
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Handle chat messages
  socket.on("chat-message", (message) => {
    io.emit("chat-message", message); // Broadcast the message to all clients
  });

  // Handle typing indicator
  socket.on("typing", (username) => {
    socket.broadcast.emit("typing", username); // Notify others that a user is typing
  });

  socket.on("stop-typing", () => {
    socket.broadcast.emit("stop-typing"); // Notify others that the user stopped typing
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
