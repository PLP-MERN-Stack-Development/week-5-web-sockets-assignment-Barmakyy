// server.js - Main server file for Socket.io chat application

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users and messages
const users = {};
const messages = [];
const typingUsers = {};
const rooms = { general: [] }; // Default room

// Store reactions per message ID
const messageReactions = {}; // { [messageId]: { [emoji]: [userId, ...] } }

// Track which users have seen each message
const messageSeen = {}; // { [messageId]: [userId, ...] }

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle user joining
  socket.on('user_join', (username) => {
    users[socket.id] = { username, id: socket.id, room: 'general' };
    socket.join('general');
    io.emit('user_list', Object.values(users));
    io.emit('user_joined', { username, id: socket.id });
    io.emit('room_list', Object.keys(rooms));
    console.log(`${username} joined the chat`);
  });

  // Handle chat messages
  socket.on('send_message', (messageData) => {
    const message = {
      ...messageData,
      id: Date.now(),
      sender: users[socket.id]?.username || 'Anonymous',
      senderId: socket.id,
      timestamp: new Date().toISOString(),
    };
    
    messages.push(message);
    
    // Limit stored messages to prevent memory issues
    if (messages.length > 100) {
      messages.shift();
    }
    
    io.emit('receive_message', message);
  });

  // Handle typing indicator
  socket.on('typing', (isTyping) => {
    if (users[socket.id]) {
      const username = users[socket.id].username;
      
      if (isTyping) {
        typingUsers[socket.id] = username;
      } else {
        delete typingUsers[socket.id];
      }
      
      io.emit('typing_users', Object.values(typingUsers));
    }
  });

  // Handle private messages
  socket.on('private_message', ({ to, message }) => {
    const messageData = {
      id: Date.now(),
      sender: users[socket.id]?.username || 'Anonymous',
      senderId: socket.id,
      message,
      timestamp: new Date().toISOString(),
      isPrivate: true,
    };
    
    socket.to(to).emit('private_message', messageData);
    socket.emit('private_message', messageData);
  });

  // Handle room messages
  socket.on('room_message', (messageText, callback) => {
    const user = users[socket.id];
    if (user) {
      const message = {
        id: Date.now(),
        sender: user.username,
        senderId: socket.id,
        message: messageText,
        room: user.room,
        timestamp: new Date().toISOString(),
      };
      io.to(user.room).emit('receive_message', message);
      if (callback) callback({ delivered: true, messageId: message.id });
    }
  });

  // Create a new room
  socket.on('create_room', (roomName) => {
    if (!rooms[roomName]) {
      rooms[roomName] = [];
      io.emit('room_list', Object.keys(rooms));
    }
  });

  // Join a room
  socket.on('join_room', (roomName) => {
    const user = users[socket.id];
    if (user) {
      socket.leave(user.room);
      socket.join(roomName);
      users[socket.id].room = roomName;
      io.emit('user_list', Object.values(users));
      // Optionally, send room history here
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const { username } = users[socket.id];
      io.emit('user_left', { username, id: socket.id });
      console.log(`${username} left the chat`);
    }
    
    delete users[socket.id];
    delete typingUsers[socket.id];
    
    io.emit('user_list', Object.values(users));
    io.emit('typing_users', Object.values(typingUsers));
  });

  // Handle reaction updates
  socket.on('add_reaction', ({ messageId, emoji, userId }) => {
    if (!messageReactions[messageId]) {
      messageReactions[messageId] = {};
    }
    if (!messageReactions[messageId][emoji]) {
      messageReactions[messageId][emoji] = [];
    }
    // Prevent duplicate reactions from the same user
    if (!messageReactions[messageId][emoji].includes(userId)) {
      messageReactions[messageId][emoji].push(userId);
    }
    io.emit('reaction_update', { messageId, reactions: messageReactions[messageId] });
  });

  // Handle file/image messages in rooms
  socket.on('room_file', (fileData) => {
    const user = users[socket.id];
    if (user) {
      const message = {
        id: Date.now(),
        sender: user.username,
        senderId: socket.id,
        file: fileData, // { name, type, data (base64) }
        room: user.room,
        timestamp: new Date().toISOString(),
      };
      io.to(user.room).emit('receive_message', message);
    }
  });

  // Handle file/image messages in private chat
  socket.on('private_file', ({ to, fileData }) => {
    const messageData = {
      id: Date.now(),
      sender: users[socket.id]?.username || 'Anonymous',
      senderId: socket.id,
      file: fileData, // { name, type, data (base64) }
      timestamp: new Date().toISOString(),
      isPrivate: true,
    };
    socket.to(to).emit('private_message', messageData);
    socket.emit('private_message', messageData);
  });

  // Handle message seen updates
  socket.on('message_seen', ({ messageId, userId, room }) => {
    if (!messageSeen[messageId]) {
      messageSeen[messageId] = [];
    }
    if (!messageSeen[messageId].includes(userId)) {
      messageSeen[messageId].push(userId);
      // Notify all users in the room/private chat
      if (room) {
        io.to(room).emit('message_seen_update', { messageId, seenBy: messageSeen[messageId] });
      } else {
        // For private messages, emit to both users
        io.to(socket.id).emit('message_seen_update', { messageId, seenBy: messageSeen[messageId] });
        // Optionally, emit to the other user as well if you track their socket id
      }
    }
  });
});

// API routes
app.get('/api/messages', (req, res) => {
  const { room, before } = req.query;
  let filtered = messages.filter(m => m.room === room);
  if (before) {
    filtered = filtered.filter(m => new Date(m.timestamp) < new Date(before));
  }
  // Return the last 20 messages before 'before'
  res.json(filtered.slice(-20));
});

app.get('/api/users', (req, res) => {
  res.json(Object.values(users));
});

// Root route
app.get('/', (req, res) => {
  res.send('Socket.io Chat Server is running');
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io }; 