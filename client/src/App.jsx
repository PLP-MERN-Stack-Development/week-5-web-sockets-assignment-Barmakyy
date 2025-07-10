// client/src/App.js
import React, { useState, useRef } from "react";
import { useSocket } from "./socket/socket";

function App() {
  const [username, setUsername] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [privateChats, setPrivateChats] = useState({}); // { userId: [messages] }
  const [activePrivateUser, setActivePrivateUser] = useState(null);
  const [privateInput, setPrivateInput] = useState("");
  const [rooms, setRooms] = useState(['general']);
  const [currentRoom, setCurrentRoom] = useState('general');
  const [newRoom, setNewRoom] = useState('');
  const [reactions, setReactions] = useState({});
  const [file, setFile] = useState(null); // For room chat
  const [privateFile, setPrivateFile] = useState(null); // For private chat
  const [seenStatus, setSeenStatus] = useState({});
  const [unread, setUnread] = useState({});
  const [windowFocused, setWindowFocused] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState(Notification.permission);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [delivered, setDelivered] = useState({});

  const fileInputRef = useRef(null);
  const privateFileInputRef = useRef(null);

  // Use your custom socket hook
  const {
    socket, // <-- add this line
    messages,
    users,
    typingUsers,
    connect,
    disconnect,
    sendMessage,
    sendPrivateMessage,
    setTyping,
    lastMessage, // already provided by your hook
  } = useSocket();

  const [isConnected, setIsConnected] = useState(socket.connected);

  React.useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    return () => {
      socket.off('connect');
      socket.off('disconnect');
    };
  }, []);

  // Listen for new private messages and update state
  React.useEffect(() => {
    if (
      lastMessage &&
      lastMessage.isPrivate &&
      lastMessage.senderId &&
      (lastMessage.senderId === activePrivateUser?.id ||
        lastMessage.senderId === socket.id)
    ) {
      setPrivateChats((prev) => {
        const userId =
          lastMessage.senderId === socket.id
            ? lastMessage.to
            : lastMessage.senderId;
        return {
          ...prev,
          [userId]: [...(prev[userId] || []), lastMessage],
        };
      });
    }
  }, [lastMessage, activePrivateUser]);

  // Listen for room list updates
  React.useEffect(() => {
    socket.on('room_list', (roomList) => {
      setRooms(roomList);
    });
    return () => socket.off('room_list');
  }, []);

  // Listen for reaction updates
  React.useEffect(() => {
    socket.on('reaction_update', ({ messageId, reactions }) => {
      setReactions((prev) => ({
        ...prev,
        [messageId]: reactions,
      }));
    });
    return () => socket.off('reaction_update');
  }, []);

  // Listen for seen updates
  React.useEffect(() => {
    socket.on('message_seen_update', ({ messageId, seenBy }) => {
      setSeenStatus((prev) => ({
        ...prev,
        [messageId]: seenBy,
      }));
    });
    return () => socket.off('message_seen_update');
  }, []);

  // Emit seen events when messages are rendered
  React.useEffect(() => {
    messages
      .filter(msg => msg.room === currentRoom && msg.sender !== username)
      .forEach(msg => {
        if (!seenStatus[msg.id]?.includes(socket.id)) {
          socket.emit('message_seen', { messageId: msg.id, userId: socket.id, room: currentRoom });
        }
      });
  }, [messages, currentRoom, username, seenStatus, socket.id]);

  // Emit seen events for private chat messages
  React.useEffect(() => {
    if (activePrivateUser) {
      (privateChats[activePrivateUser.id] || []).forEach(msg => {
        if (!seenStatus[msg.id]?.includes(socket.id)) {
          socket.emit('message_seen', { messageId: msg.id, userId: socket.id, room: activePrivateUser.id });
        }
      });
    }
  }, [privateChats, activePrivateUser, seenStatus, socket.id]);

  // Handle login
  const handleLogin = (e) => {
    e.preventDefault();
    if (usernameInput.trim()) {
      setUsername(usernameInput.trim());
      connect(usernameInput.trim());
    }
  };

  // File input handlers
  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };
  const handlePrivateFileChange = (e) => {
    setPrivateFile(e.target.files[0]);
  };

  // Public chat send handler
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        socket.emit('room_file', {
          name: file.name,
          type: file.type,
          data: reader.result, // base64 string
        });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      };
      reader.readAsDataURL(file);
    } else if (messageInput.trim()) {
      socket.emit('room_message', messageInput, (ack) => {
        if (ack?.delivered) {
          setDelivered((prev) => ({ ...prev, [ack.messageId]: true }));
        }
      });
      setMessageInput('');
      setTyping(false);
    }
  };

  // Handle typing
  const handleInputChange = (e) => {
    setMessageInput(e.target.value);
    setTyping(true);
    // Optionally, debounce setTyping(false) after a delay
  };

  const handleCreateRoom = (e) => {
    e.preventDefault();
    if (newRoom.trim() && !rooms.includes(newRoom.trim())) {
      socket.emit('create_room', newRoom.trim());
      setNewRoom('');
    }
  };

  const handleJoinRoom = (room) => {
    setCurrentRoom(room);
    socket.emit('join_room', room);
  };

  // Private chat send handler
  const handleSendPrivateMessage = (e) => {
    e.preventDefault();
    if (privateFile) {
      const reader = new FileReader();
      reader.onload = () => {
        const fileMsg = {
          sender: username,
          file: {
            name: privateFile.name,
            type: privateFile.type,
            data: reader.result,
          },
          timestamp: new Date().toISOString(),
          isPrivate: true,
        };
        // Emit to server
        socket.emit('private_file', {
          to: activePrivateUser.id,
          fileData: fileMsg.file,
        });
        // Update local state immediately
        setPrivateChats((prev) => ({
          ...prev,
          [activePrivateUser.id]: [
            ...(prev[activePrivateUser.id] || []),
            fileMsg,
          ],
        }));
        setPrivateFile(null);
        if (privateFileInputRef.current) privateFileInputRef.current.value = "";
      };
      reader.readAsDataURL(privateFile);
    } else if (privateInput.trim()) {
      sendPrivateMessage(activePrivateUser.id, privateInput);
      setPrivateChats((prev) => ({
        ...prev,
        [activePrivateUser.id]: [
          ...(prev[activePrivateUser.id] || []),
          {
            sender: username,
            message: privateInput,
            timestamp: new Date().toISOString(),
            isPrivate: true,
          },
        ],
      }));
      setPrivateInput("");
    }
  };

  // Play sound notification
  const playSound = () => {
    const audio = new window.Audio('/notify.mp3');
    audio.play();
  };

  // Window focus tracking
  React.useEffect(() => {
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Browser notification permission request
  React.useEffect(() => {
    if (notificationPermission === 'default' && 'Notification' in window) {
      Notification.requestPermission().then(setNotificationPermission);
    }
  }, [notificationPermission]);

  // Handle new messages for notifications and unread count
  React.useEffect(() => {
    const onReceiveMessage = (msg) => {
      // Add message to state
      if (msg.isPrivate) {
        setPrivateChats((prev) => ({
          ...prev,
          [msg.senderId]: [...(prev[msg.senderId] || []), msg],
        }));
      } else {
        // For room messages, add to messages state
        // setMessages((prev) => [...prev, msg]); // This line was removed from original, so it's removed here.
      }

      // Unread logic
      if (
        (msg.room && msg.room !== currentRoom) ||
        (msg.isPrivate && activePrivateUser?.id !== msg.senderId)
      ) {
        setUnread((prev) => ({
          ...prev,
          [msg.room || msg.senderId]: (prev[msg.room || msg.senderId] || 0) + 1,
        }));
      }
      // Sound notification
      if (!windowFocused) playSound();
      // Browser notification
      if (
        notificationPermission === 'granted' &&
        ((msg.room && msg.room !== currentRoom) ||
          (msg.isPrivate && activePrivateUser?.id !== msg.senderId))
      ) {
        new Notification(`New message from ${msg.sender}`, {
          body: msg.message || msg.file?.name || 'File received',
          icon: '/chat-icon.png', // Optional: add an icon to public/
        });
      }
    };

    socket.on('receive_message', onReceiveMessage);
    socket.on('private_message', onReceiveMessage);
    socket.on('room_message', onReceiveMessage);
    socket.on('private_file', onReceiveMessage);
    socket.on('room_file', onReceiveMessage);

    return () => {
      socket.off('receive_message', onReceiveMessage);
      socket.off('private_message', onReceiveMessage);
      socket.off('room_message', onReceiveMessage);
      socket.off('private_file', onReceiveMessage);
      socket.off('room_file', onReceiveMessage);
    };
  }, [currentRoom, activePrivateUser, windowFocused, notificationPermission, messages, privateChats]);

  // Reset unread count when viewing room/chat
  React.useEffect(() => {
    setUnread((prev) => ({
      ...prev,
      [currentRoom]: 0,
      ...(activePrivateUser ? { [activePrivateUser.id]: 0 } : {}),
    }));
  }, [currentRoom, activePrivateUser]);

  const loadOlderMessages = async () => {
    setLoadingMore(true);
    const oldest = messages[0]?.timestamp;
    const res = await fetch(`/api/messages?room=${currentRoom}&before=${oldest}`);
    const older = await res.json();
    setMessages(prev => [...older, ...prev]);
    setHasMore(older.length === 20);
    setLoadingMore(false);
  };

  if (!username) {
    return (
      <form
        onSubmit={handleLogin}
        className="flex flex-col items-center justify-center h-screen"
      >
        <input
          value={usernameInput}
          onChange={(e) => setUsernameInput(e.target.value)}
          placeholder="Enter your username"
          className="px-4 py-2 border border-gray-300 rounded mb-2"
          required
        />
        <button
          type="submit"
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Join Chat
        </button>
      </form>
    );
  }

  return (
    <div className="max-w-2xl w-full mx-auto mt-4 p-4 sm:p-8 bg-white rounded shadow">
      <h2 className="text-2xl font-bold mb-2">Global Chat Room</h2>
      <div className="mb-4 text-sm">
        <span className="font-semibold">Online users:</span>{" "}
        {users.map((u) =>
          u.username === username ? (
            <span key={u.id} className="font-bold text-blue-600">{u.username} (You)</span>
          ) : (
            <span key={u.id} className="inline-flex items-center mr-2 relative">
              {u.username}
              <button
                className="ml-1 px-2 py-0.5 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                onClick={() => setActivePrivateUser(u)}
              >
                Message
              </button>
              {unread[u.id] > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-1">
                  {unread[u.id]}
                </span>
              )}
            </span>
          )
        )}
      </div>
      <div className="mb-4 flex items-center gap-2">
        <div className="font-semibold">Rooms:</div>
        {rooms.map((room) => (
          <button
            key={room}
            onClick={() => handleJoinRoom(room)}
            className={`px-2 py-1 rounded relative ${
              currentRoom === room
                ? "bg-blue-500 text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            {room}
            {unread[room] > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-1">
                {unread[room]}
              </span>
            )}
          </button>
        ))}
        <form onSubmit={handleCreateRoom} className="flex items-center gap-1">
          <input
            value={newRoom}
            onChange={(e) => setNewRoom(e.target.value)}
            placeholder="New room"
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <button
            type="submit"
            className="bg-green-500 text-white px-2 py-1 rounded text-sm"
          >
            +
          </button>
        </form>
      </div>
      <div className="min-h-[300px] max-h-[400px] overflow-y-auto mb-4 bg-gray-50 p-3 rounded">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search messages"
          className="mb-2 px-2 py-1 border rounded w-full"
        />
        {messages
          .filter(msg => msg.message?.toLowerCase().includes(search.toLowerCase()))
          .map((msg, idx) =>
            msg.system ? (
              <div key={idx} className="text-gray-400 italic text-sm mb-2">
                {msg.message}
              </div>
            ) : (
              <div
                key={idx}
                className={`flex items-center mb-2 ${
                  msg.sender === username ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`px-3 py-2 rounded-lg shadow ${
                    msg.sender === username
                      ? "bg-purple-600 text-white"
                      : "bg-white text-gray-800"
                  } max-w-[70%]`}
                >
                  <div className="font-semibold text-xs mb-1">{msg.sender}</div>
                  {msg.file ? (
                    msg.file.type.startsWith('image/') ? (
                      <img
                        src={msg.file.data}
                        alt={msg.file.name}
                        className="max-w-xs max-h-40 rounded mt-2"
                      />
                    ) : (
                      <a
                        href={msg.file.data}
                        download={msg.file.name}
                        className="text-black-500 underline mt-2 block"
                      >
                        {msg.file.name}
                      </a>
                    )
                  ) : (
                    <div className="break-words">{msg.message}</div>
                  )}
                  <div className="text-[10px] text-gray-300 text-right mt-1">
                    {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ""}
                  </div>
                  <div className="text-[10px] text-green-500 text-right mt-1">
                    {seenStatus[msg.id]?.length > 0 && (
                      <span>
                        ✓ Seen {msg.room ? seenStatus[msg.id].length : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 mt-1">
                    {['👍', '❤️', '😂', '😮'].map((emoji) => (
                      <button
                        key={emoji}
                        className="text-lg hover:scale-110 transition-transform"
                        onClick={() =>
                          socket.emit('add_reaction', {
                            messageId: msg.id,
                            emoji,
                            userId: socket.id,
                          })
                        }
                        type="button"
                      >
                        {emoji}
                        <span className="text-xs ml-1">
                          {reactions[msg.id]?.[emoji]?.length > 0
                            ? reactions[msg.id][emoji].length
                            : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                  {delivered[msg.id] && (
                    <span className="text-green-500 ml-1">✔✔</span>
                  )}
                </div>
              </div>
            )
          )}
        {typingUsers.length > 0 && (
          <div className="text-gray-400 italic text-xs">
            <em>
              {typingUsers.map((u) => u.username).join(", ")}{" "}
              {typingUsers.length === 1 ? "is" : "are"} typing...
            </em>
          </div>
        )}
        {hasMore && (
          <button onClick={loadOlderMessages} disabled={loadingMore} className="text-xs text-blue-500 mb-2">
            {loadingMore ? "Loading..." : "Load older messages"}
          </button>
        )}
      </div>
      <form
        onSubmit={handleSendMessage}
        className="flex gap-2 items-center mt-2 w-full"
      >
        <input
          type="file"
          onChange={handleFileChange}
          ref={fileInputRef}
          className="block w-1/3"
        />
        <input
          value={messageInput}
          onChange={handleInputChange}
          placeholder="Type a message"
          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring focus:border-blue-400"
          required={!file}
        />
        <button
          type="submit"
          disabled={!isConnected || (!messageInput.trim() && !file)}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {!isConnected && (
        <div className="text-red-500 text-center mb-2">Reconnecting...</div>
      )}
      <button
        onClick={disconnect}
        className="mt-4 text-sm text-red-500 hover:underline"
      >
        Disconnect
      </button>
      {activePrivateUser && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md sm:max-w-2xl p-2 sm:p-6 relative">
            <button
              className="absolute top-2 right-2 text-gray-400 hover:text-gray-700"
              onClick={() => setActivePrivateUser(null)}
            >
              &times;
            </button>
            <h3 className="text-lg font-bold mb-2">
              Private chat with {activePrivateUser.username}
            </h3>
            <div className="min-h-[200px] max-h-[300px] overflow-y-auto mb-4 bg-gray-50 p-3 rounded">
              {(privateChats[activePrivateUser.id] || []).map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex items-center mb-2 ${
                    msg.sender === username ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`px-3 py-2 rounded-lg shadow ${
                      msg.sender === username
                        ? "bg-purple-600 text-white"
                        : "bg-white text-gray-800"
                    } max-w-[70%]`}
                  >
                    <div className="font-semibold text-xs mb-1">{msg.sender}</div>
                    {/* File/image rendering */}
                    {msg.file ? (
                      msg.file.type.startsWith('image/') ? (
                        <img
                          src={msg.file.data}
                          alt={msg.file.name}
                          className="max-w-xs max-h-40 rounded mt-2"
                        />
                      ) : (
                        <a
                          href={msg.file.data}
                          download={msg.file.name}
                          className="text-black-500 underline mt-2 block"
                        >
                          {msg.file.name}
                        </a>
                      )
                    ) : (
                      <div className="break-words">{msg.message}</div>
                    )}
                    <div className="text-[10px] text-gray-300 text-right mt-1">
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ""}
                    </div>
                    {/* Reactions */}
                    <div className="flex gap-1 mt-1">
                      {['👍', '❤️', '😂', '😮'].map((emoji) => (
                        <button
                          key={emoji}
                          className="text-lg hover:scale-110 transition-transform"
                          onClick={() =>
                            socket.emit('add_reaction', {
                              messageId: msg.id,
                              emoji,
                              userId: socket.id,
                            })
                          }
                          type="button"
                        >
                          {emoji}
                          <span className="text-xs ml-1">
                            {reactions[msg.id]?.[emoji]?.length > 0
                              ? reactions[msg.id][emoji].length
                              : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] text-green-500 text-right mt-1">
                      {seenStatus[msg.id]?.length > 0 && (
                        <span>
                          ✓ Seen {seenStatus[msg.id].length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <form
              onSubmit={handleSendPrivateMessage}
              className="flex flex-col sm:flex-row gap-2 items-center w-full mt-2"
            >
              <input
                type="file"
                onChange={handlePrivateFileChange}
                ref={privateFileInputRef}
                className="w-full sm:w-1/3"
              />
              <input
                value={privateInput}
                onChange={(e) => setPrivateInput(e.target.value)}
                placeholder="Type a private message"
                className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring focus:border-blue-400"
                required={!privateFile}
              />
              <button
                type="submit"
                className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
                disabled={!privateInput.trim() && !privateFile}
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
