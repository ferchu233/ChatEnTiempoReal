const mysql = require('mysql');
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const multer = require('multer');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const connection = mysql.createConnection({
  host: '',
  user: '',
  password: '',
  database: ''
});

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(session({
  secret: 'secret',
  resave: true,
  saveUninitialized: true,
  cookie: {
    secure: false,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now());
  }
});

const upload = multer({ storage: storage });

const obtenerUsuarios = (myUser, callback) => {
  connection.query(
    'SELECT * FROM usuario JOIN amigoUser ON usuario.id = amigoUser.receiver_id OR usuario.id = amigoUser.sender_id WHERE usuario.nombreUser <> ? AND amigoUser.EstadoId = 3 AND (amigoUser.sender_id = (SELECT id FROM usuario WHERE nombreUser = ?) OR amigoUser.receiver_id = (SELECT id FROM usuario WHERE nombreUser = ?)) ORDER BY usuario.nombreUser',
    [myUser, myUser, myUser],
    function (error, results, fields) {
      if (error) return callback(error);
      const usernames = results.map(user => user.nombreUser);
      callback(null, results, usernames);
    }
  );
};

const obtenerDibujosAntiguos = (myUser, username, callback) => {
  if (username === undefined) {
    username = "Mi Galeria";
  }
  
  const sqlQuery = `SELECT * FROM dibujo WHERE (sender = ? AND recipient = ?) OR (recipient = ? AND sender = ?) ORDER BY created_at`;
  connection.query(sqlQuery, [myUser, username, myUser, username], function (error, results, fields) {
    if (error) {
      console.error('Error al obtener los dibujos antiguos:', error);
      return callback(error);
    }
    const drawingsData = {
      sender: username,
      drawings: results.map(drawing => ({
        ...drawing,
        image: drawing.image instanceof Buffer ? `data:image/png;base64,${drawing.image.toString('base64')}` : drawing.image
      }))
    };
    console.log('Dibujos enviados al cliente:', drawingsData);
    callback(null, drawingsData);
  });
};

const obtenerMensajesAntiguos = (myUser, otherUser, callback) => {
  const sqlQuery = 'SELECT * FROM messages WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?) ORDER BY created_at';
  connection.query(sqlQuery, [myUser, otherUser, otherUser, myUser], function (error, messages, fields) {
    if (error) {
      console.error('Error al obtener los mensajes antiguos:', error);
      return callback(error);
    }
    callback(null, messages);
  });
};

const obtenerUsuariosSoli = (myUser, callback) => {
  connection.query(
    `SELECT *
    FROM usuario
    WHERE id <> (SELECT id FROM usuario WHERE nombreUser = ?)
    AND id NOT IN (
      SELECT receiver_id
      FROM amigoUser
      WHERE sender_id = (SELECT id FROM usuario WHERE nombreUser = ?) AND EstadoId IS NOT NULL
    )`,
    [myUser, myUser],
    function (error, results, fields) {
      if (error) {
        console.error('Error al obtener los usuarios sin solicitud:', error);
        return callback(error);
      }
      const usersSoli = results.map(userr => userr.nombreUser);
      callback(null, results, usersSoli);
    }
  );
};

const MostrarSolicitudesParaAceptarORechazar = (myUser, callback) => {
  connection.query(
    `SELECT DISTINCT *
    FROM amigoUser au
    JOIN usuario u ON au.sender_id = u.id
    WHERE au.receiver_id = (SELECT id FROM usuario WHERE nombreUser = ?) AND au.EstadoId = 1
    GROUP BY u.nombreUser`,
    [myUser],
    function (error, results, fields) {
      if (error) {
        console.error('Error al obtener las solicitudes:', error);
        return callback(error);
      }
      const MostrarAc = results.map(userr => userr.nombreUser);
      callback(null, results, MostrarAc);
    }
  );
};

app.post('/entrar', (req, res) => {
  const { username, password } = req.body;
  
  if (username && password) {
    connection.query(
      'SELECT * FROM usuario WHERE nombreUser = ? AND contraseña = ?',
      [username, password],
      (error, results) => {
        if (error) {
          res.status(500).send('Error en la base de datos');
          return;
        }
        
        if (results.length > 0) {
          req.session.loggedin = true;
          req.session.username = username;
          res.redirect('/main');
        } else {
          res.send('Usuario o contraseña incorrectos');
        }
      }
    );
  } else {
    res.send('Por favor, ingrese usuario y contraseña');
  }
});

app.post('/Registrar', (req, res) => {
  const { usernameR, passwordR } = req.body;

  if (usernameR && passwordR) {
    connection.query(
      'INSERT INTO usuario (nombreUser, contraseña, fotoPerfil) VALUES (?, ?, ?)',
      [usernameR, passwordR, "perfil2.png"],
      (error, results) => {
        if (error) {
          res.status(500).send('Error en la base de datos');
          return;
        }
        res.redirect('/');
      }
    );
  } else {
    res.send('Por favor, ingrese usuario y contraseña');
  }
});

app.get('/main', (req, res) => {
  if (!req.session.loggedin) {
    return res.redirect('/');
  }

  const myUser = req.session.username;
  const selectedUser = req.session.userSelection;

  MostrarSolicitudesParaAceptarORechazar(myUser, (error, solicitudes, MostrarAc) => {
    if (error) {
      return res.status(500).send('Error al recuperar solicitudes');
    }

    obtenerUsuariosSoli(myUser, (error, usuariosSoli, usersSoli) => {
      if (error) {
        return res.status(500).send('Error al recuperar usuarios');
      }

      obtenerUsuarios(myUser, (error, users) => {
        if (error) {
          return res.status(500).send('Error al recuperar usuarios');
        }

        obtenerMensajesAntiguos(myUser, selectedUser, (error, oldMessages) => {
          if (error) {
            return res.status(500).send('Error al recuperar mensajes');
          }

          obtenerDibujosAntiguos(myUser, selectedUser, (error, drawingsData) => {
            if (error) {
              return res.status(500).send('Error al recuperar dibujos');
            }

            res.render('main', {
              username: myUser,
              users,
              selectedUser,
              oldMessages,
              drawingsData,
              MostrarAc: solicitudes,
              usersSoli: usuariosSoli
            });
          });
        });
      });
    });
  });
});

app.set('view engine', 'ejs');
app.set('views', __dirname);

app.post('/api/friend-requests', (req, res) => {
  const myUser = req.session.username;
  const { receiver_id, receiver_username } = req.body;
  const estado = 1;

  connection.query(
    'INSERT INTO amigoUser (sender_id, receiver_id, EstadoId, created_at) VALUES ((SELECT id FROM usuario WHERE nombreUser=?), ?, ?, NOW())',
    [myUser, receiver_id, estado],
    (error) => {
      if (error) {
        return res.status(500).json({ error: 'Error al enviar solicitud de amistad' });
      }
      res.json({ success: true });
    }
  );
});

app.post('/api/friend-requests/reject', (req, res) => {
  const { remitenteId } = req.body;
  const myUser = req.session.username;

  connection.query(
    'UPDATE amigoUser SET EstadoId = 2 WHERE sender_id = ? AND receiver_id = (SELECT id FROM usuario WHERE nombreUser = ?) AND EstadoId = 1',
    [remitenteId, myUser],
    (error) => {
      if (error) {
        return res.status(500).json({ error: 'Error al rechazar solicitud de amistad' });
      }
      res.json({ success: true });
    }
  );
});

app.post('/api/friend-requests/accept', (req, res) => {
  const { remitenteId } = req.body;
  const myUser = req.session.username;

  connection.query(
    'UPDATE amigoUser SET EstadoId = 3 WHERE sender_id = ? AND receiver_id = (SELECT id FROM usuario WHERE nombreUser = ?) AND EstadoId = 1',
    [remitenteId, myUser],
    (error) => {
      if (error) {
        return res.status(500).json({ error: 'Error al aceptar solicitud de amistad' });
      }
      res.json({ success: true });
    }
  );
});

app.post('/api/drawings', (req, res) => {
  const { nombre, imagen, descripcion } = req.body;

  console.log('Datos recibidos en /api/drawings:', { nombre, imagen: imagen.substring(0, 50) + '...', descripcion });

  if (!nombre || !imagen || !descripcion) {
    console.error('Faltan campos requeridos:', { nombre, imagen: !!imagen, descripcion });
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const base64Data = imagen.replace(/^data:image\/png;base64,/, "");
  const binaryImage = Buffer.from(base64Data, 'base64');

  connection.query(
    'INSERT INTO dibujo (sender, recipient, image, created_at) VALUES (?, ?, ?, NOW())',
    [nombre, descripcion, binaryImage],
    (error, results) => {
      if (error) {
        console.error('Error al guardar dibujo en la base de datos:', error);
        return res.status(500).json({ error: 'Error al guardar dibujo', details: error.message });
      }
      console.log('Dibujo guardado con éxito:', { id: results.insertId });
      res.json({
        success: true,
        drawingId: results.insertId
      });
    }
  );
});

app.get('/api/drawings', (req, res) => {
  const sender = req.query.sender;
  const recipient = req.query.recipient;

  obtenerDibujosAntiguos(sender, recipient, (error, drawingsData) => {
    if (error) {
      return res.status(500).json({ error: 'Error al recuperar dibujos' });
    }
    res.json(drawingsData);
  });
});

io.on('connection', (socket) => {
  console.log('Un usuario se conectó');

  socket.on('username', (username) => {
    socket.username = username;
    console.log(`${username} se unió`);
  });

  socket.on('chat message', (data) => {
    const sender = socket.username;
    const recipient = data.recipient;
    const message = data.message;

    connection.query(
      'INSERT INTO messages (sender, recipient, message) VALUES (?, ?, ?)',
      [sender, recipient, message],
      (error) => {
        if (error) {
          console.error('Error al guardar mensaje:', error);
          return;
        }
        io.emit('chat message', { message, sender, recipient });
      }
    );
  });

  socket.on('request old messages', (data) => {
    const sender = socket.username;
    const recipient = data.recipient;

    obtenerMensajesAntiguos(sender, recipient, (error, messages) => {
      if (error) {
        console.error('Error al recuperar mensajes:', error);
        return;
      }
      console.log(`Enviando mensajes antiguos entre ${sender} y ${recipient}:`, messages);
      socket.emit('old messages', { recipient, messages });
    });
  });

  socket.on('disconnect', () => {
    console.log('Usuario desconectado');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});