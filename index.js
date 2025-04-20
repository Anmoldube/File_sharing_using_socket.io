const express = require("express");
const path = require("path");
const multer = require("multer");
const mongoose = require("mongoose");
const { WebSocketServer } = require("ws");
const http = require("http");

const app = express();
const PORT = 3000;

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

// Create a model for the file
const File = mongoose.model("File", fileSchema);

// Middleware to parse JSON
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.resolve("./views"));

// Middleware to parse URL-encoded data
app.use(express.urlencoded({ extended: false }));

// Serve static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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

// Route to render the chat page
app.get("/", (req, res) => {
  return res.render("chat");
});

// Route to handle file uploads
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const fileHash = req.file.filename; // Use filename as a simple hash for deduplication

    // Check if the file already exists in the database
    const existingFile = await File.findOne({ hash: fileHash });
    if (existingFile) {
      console.log("File already exists in the database:", existingFile);

      // Notify all WebSocket clients about the existing file
      broadcastFile(existingFile);

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

    // Notify all WebSocket clients about the new file
    broadcastFile(file);

    return res
      .status(200)
      .json({ message: "File uploaded successfully", file });
  } catch (err) {
    console.error("Error saving file to database:", err);
    return res.status(500).send("Internal Server Error");
  }
});

// WebSocket server setup
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("New WebSocket connection");

  ws.on("message", (message) => {
    console.log("Received message:", message);
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
  });
});

// Broadcast file information to all connected clients
function broadcastFile(file) {
  const fileData = {
    filename: file.filename,
    path: `/uploads/${file.filename}`,
    size: file.size,
    uploadDate: file.uploadDate,
  };

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(fileData));
    }
  });
}

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
