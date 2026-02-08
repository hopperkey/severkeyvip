
const { Pool } = require('pg');

// Kết nối Neon Database
let pool;
let databaseConnected = false;
let initializationAttempted = false;

async function initializeDatabaseWithRetry() {
  if (initializationAttempted && databaseConnected) {
    return true;
  }
  
  initializationAttempted = true;
  const maxRetries = 5;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Database connection attempt ${attempt}/${maxRetries}`);
      
      const databaseUrl = process.env.DATABASE_URL;
      
      if (!databaseUrl) {
        console.log('❌ DATABASE_URL not found in environment variables');
        return false;
      }

      console.log('📝 Using database URL, length:', databaseUrl.length);
      
      pool = new Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 30000,
        idleTimeoutMillis: 10000,
        max: 5,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      });

      const client = await pool.connect();
      console.log('✅ Database connected successfully');
      
      await initializeTables(client);
      client.release();
      
      databaseConnected = true;
      console.log('✅ Database fully initialized');
      return true;
      
    } catch (error) {
      console.error(`❌ Database attempt ${attempt} failed:`, error.message);
      
      if (pool) {
        try {
          await pool.end();
        } catch (e) {
          console.error('Error closing pool:', e);
        }
        pool = null;
      }
      
      if (attempt < maxRetries) {
        console.log(`⏳ Retrying in 2s...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  console.log('❌ All database connection attempts failed');
  return false;
}

async function initializeTables(client) {
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        api_key VARCHAR(255) UNIQUE NOT NULL,
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS keys (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        api VARCHAR(255) NOT NULL,
        prefix VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        hwid TEXT,
        banned BOOLEAN DEFAULT FALSE,
        used BOOLEAN DEFAULT FALSE,
        device_limit INTEGER DEFAULT 1,
        system_info TEXT,
        first_used TIMESTAMP,
        FOREIGN KEY (api) REFERENCES applications(api_key) ON DELETE CASCADE
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS supports (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) UNIQUE NOT NULL,
        added_by VARCHAR(255) NOT NULL,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      INSERT INTO supports (user_id, added_by) 
      VALUES ('techdavisk007', 'system')
      ON CONFLICT (user_id) DO NOTHING
    `);

    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Table initialization failed:', error);
    throw error;
  }
}

const MAIN_ADMIN_ID = 'techdavisk007';
const MAX_APPS_FOR_SUPPORT = 10;

module.exports = async (req, res) => {
  console.log('🔧 Function invoked:', req.method, req.url);
  
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET, PUT, DELETE');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check endpoint
  if (req.method === 'GET' && req.url.includes('/health')) {
    const healthStatus = {
      success: true,
      message: 'API Health Check',
      timestamp: new Date().toISOString(),
      environment: {
        database_url: !!process.env.DATABASE_URL
      },
      database: {
        connected: databaseConnected,
        initialized: initializationAttempted
      },
      version: '2.0.0'
    };
    
    return res.status(200).json(healthStatus);
  }

  // Kiểm tra database connection
  if (!databaseConnected || !pool) {
    console.log('🔄 Database not connected, attempting to reconnect...');
    const reconnected = await initializeDatabaseWithRetry();
    
    if (!reconnected) {
      return res.status(503).json({
        success: false,
        message: 'Database connection failed',
        timestamp: new Date().toISOString()
      });
    }
  }

  try {
    let body = {};
    if (req.method === 'POST' && req.body) {
      body = req.body;
    }

    const { action } = body;

    console.log('🔧 Action received:', action);

    switch (action) {
      case 'check_support':
        return await handleCheckSupport(body, res);
      
      case 'test':
        return res.status(200).json({ 
          success: true, 
          message: 'API is working with PostgreSQL!',
          timestamp: new Date().toISOString(),
          database: 'connected'
        });

      case 'create_app':
        return await handleCreateApp(body, res);

      case 'delete_app':
        return await handleDeleteApp(body, res);

      case 'create_key':
        return await handleCreateKey(body, res);

      case 'delete_key':
        return await handleDeleteKey(body, res);

      case 'ban_key':
        return await handleBanKey(body, res);

      case 'check_key':
        return await handleCheckKey(body, res);

      case 'reset_hwid':
        return await handleResetHWID(body, res);

      case 'get_apps':
        return await handleGetApps(body, res);

      case 'get_my_apps':
        return await handleGetMyApps(body, res);

      case 'get_keys':
        return await handleGetKeys(body, res);

      case 'list_keys':
        return await handleListKeys(body, res);

      case 'add_support':
        return await handleAddSupport(body, res);

      case 'delete_support':
        return await handleDeleteSupport(body, res);

      case 'get_supports':
        return await handleGetSupports(res);

      case 'validate_key':
        return await handleValidateKey(body, res);

      case 'check_permission':
        return await handleCheckPermission(body, res);

      default:
        if (req.method === 'GET') {
          return res.status(200).json({
            success: true,
            message: 'KeyAuth API is running!',
            timestamp: new Date().toISOString(),
            database: databaseConnected ? 'connected' : 'disconnected',
            version: '2.0.0',
            copyright: 'techdavisk007'
          });
        }
        return res.status(400).json({ success: false, message: 'Invalid action: ' + action });
    }

  } catch (error) {
    console.error('❌ Handler error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error: ' + error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// ==================== PERMISSION FUNCTIONS ====================

async function checkIfAdmin(user_id) {
  return user_id === MAIN_ADMIN_ID;
}

async function getUserAppCount(user_id) {
  const result = await pool.query(
    'SELECT COUNT(*) as count FROM applications WHERE created_by = $1',
    [user_id]
  );
  return parseInt(result.rows[0].count);
}

async function checkAppPermission(user_id, api_key) {
  if (user_id === MAIN_ADMIN_ID) return { hasPermission: true, isAdmin: true };

  const supportCheck = await pool.query('SELECT * FROM supports WHERE user_id = $1', [user_id]);
  
  if (supportCheck.rows.length > 0) {
    return { hasPermission: true, isAdmin: false };
  }

  const result = await pool.query(
    'SELECT * FROM applications WHERE api_key = $1 AND created_by = $2',
    [api_key, user_id]
  );
  
  return { 
    hasPermission: result.rows.length > 0, 
    isAdmin: false 
  };
}

// ==================== DATABASE HANDLERS ====================

async function handleCheckSupport(body, res) {
  const { user_id } = body;
  if (!user_id) return res.status(400).json({ success: false, message: 'User ID is required' });

  const result = await pool.query('SELECT * FROM supports WHERE user_id = $1', [user_id]);
  
  if (result.rows.length > 0) {
    return res.status(200).json({ 
      success: true, 
      is_support: true,
      user: result.rows[0]
    });
  } else {
    return res.status(200).json({ 
      success: false, 
      is_support: false, 
      message: 'User không có quyền truy cập' 
    });
  }
}

async function handleCheckPermission(body, res) {
  const { user_id, api } = body;
  
  if (!user_id) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }

  const permission = await checkAppPermission(user_id, api);
  const appCount = await getUserAppCount(user_id);
  const isAdmin = await checkIfAdmin(user_id);
  
  return res.status(200).json({ 
    success: true, 
    has_permission: permission.hasPermission,
    is_admin: isAdmin,
    app_count: appCount,
    max_apps: isAdmin ? 999 : MAX_APPS_FOR_SUPPORT
  });
}

async function handleCreateApp(body, res) {
  const { app_name, user_id } = body;
  
  if (!app_name) {
    return res.status(400).json({ success: false, message: 'App name is required' });
  }

  if (!user_id) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }

  const api_key = 'api_' + Math.random().toString(36).substr(2, 16);

  try {
    const isAdmin = await checkIfAdmin(user_id);
    const userAppCount = await getUserAppCount(user_id);
    
    if (!isAdmin && userAppCount >= MAX_APPS_FOR_SUPPORT) {
      return res.status(200).json({ 
        success: false, 
        message: `Bạn đã đạt giới hạn ${MAX_APPS_FOR_SUPPORT} applications. Chỉ admin mới có thể tạo thêm.` 
      });
    }

    const existingApp = await pool.query('SELECT * FROM applications WHERE name = $1', [app_name]);
    if (existingApp.rows.length > 0) {
      return res.status(200).json({ success: false, message: 'App already exists' });
    }

    await pool.query(
      'INSERT INTO applications (name, api_key, created_by) VALUES ($1, $2, $3)',
      [app_name, api_key, user_id]
    );

    console.log('✅ App created:', app_name, 'by user:', user_id);
    return res.status(200).json({ 
      success: true, 
      message: 'App created successfully',
      api_key: api_key 
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(200).json({ success: false, message: 'App already exists' });
    }
    throw error;
  }
}

async function handleCreateKey(body, res) {
  const { api, prefix, days, device_limit, user_id } = body;
  
  if (!api || !prefix || !days || !user_id) {
    return res.status(400).json({ success: false, message: 'Missing required fields: api, prefix, days, user_id' });
  }

  const permission = await checkAppPermission(user_id, api);
  if (!permission.hasPermission) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền tạo key cho application này' });
  }

  const keyString = `${prefix}-${generateKey()}`;
  const expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const deviceLimit = parseInt(device_limit) || 1;

  const appResult = await pool.query('SELECT * FROM applications WHERE api_key = $1', [api]);
  if (appResult.rows.length === 0) {
    return res.status(200).json({ success: false, message: 'Invalid API' });
  }

  await pool.query(
    `INSERT INTO keys (key, api, prefix, expires_at, device_limit) 
     VALUES ($1, $2, $3, $4, $5)`,
    [keyString, api, prefix, expires_at, deviceLimit]
  );

  console.log('✅ Key created:', keyString);
  return res.status(200).json({ 
    success: true, 
    message: 'Key created successfully',
    key: keyString 
  });
}

async function handleGetApps(body, res) {
  const { user_id } = body;
  const isAdmin = await checkIfAdmin(user_id);
  const supportCheck = await pool.query('SELECT * FROM supports WHERE user_id = $1', [user_id]);
  const isSupport = supportCheck.rows.length > 0;

  let query = `
    SELECT 
      a.*,
      COALESCE(COUNT(k.id), 0) as key_count
    FROM applications a
    LEFT JOIN keys k ON a.api_key = k.api
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `;

  let params = [];
  if (!isAdmin && !isSupport) {
    query = `
      SELECT 
        a.*,
        COALESCE(COUNT(k.id), 0) as key_count
      FROM applications a
      LEFT JOIN keys k ON a.api_key = k.api
      WHERE a.created_by = $1
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `;
    params = [user_id];
  }

  const result = await pool.query(query, params);
  
  return res.status(200).json({ 
    success: true, 
    applications: result.rows,
    is_admin: isAdmin
  });
}

async function handleGetMyApps(body, res) {
  const { user_id } = body;
  
  if (!user_id) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }

  const result = await pool.query(
    'SELECT * FROM applications WHERE created_by = $1 ORDER BY created_at DESC',
    [user_id]
  );
  
  return res.status(200).json({ 
    success: true, 
    applications: result.rows 
  });
}

async function handleDeleteApp(body, res) {
  const { app_name, user_id } = body;
  
  if (!app_name || !user_id) {
    return res.status(400).json({ success: false, message: 'App name and User ID are required' });
  }

  const appResult = await pool.query('SELECT * FROM applications WHERE name = $1', [app_name]);
  if (appResult.rows.length === 0) {
    return res.status(200).json({ success: false, message: 'App not found' });
  }

  const app = appResult.rows[0];
  const isAdmin = await checkIfAdmin(user_id);
  
  if (!isAdmin && app.created_by !== user_id) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa application này' });
  }

  await pool.query('DELETE FROM applications WHERE name = $1', [app_name]);
  return res.status(200).json({ success: true, message: 'App deleted successfully' });
}

async function handleDeleteKey(body, res) {
  const { api, key, user_id } = body;
  
  if (!api || !key || !user_id) {
    return res.status(400).json({ success: false, message: 'API, Key and User ID are required' });
  }

  const permission = await checkAppPermission(user_id, api);
  if (!permission.hasPermission) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa key của application này' });
  }

  const result = await pool.query(
    'DELETE FROM keys WHERE key = $1 AND api = $2 RETURNING *',
    [key, api]
  );
  
  if (result.rows.length === 0) {
    return res.status(200).json({ success: false, message: 'Key not found' });
  }
  
  return res.status(200).json({ success: true, message: 'Key deleted successfully' });
}

async function handleBanKey(body, res) {
  const { api, key, user_id } = body;
  
  if (!api || !key || !user_id) {
    return res.status(400).json({ success: false, message: 'API, Key and User ID are required' });
  }

  const permission = await checkAppPermission(user_id, api);
  if (!permission.hasPermission) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền ban key của application này' });
  }

  const result = await pool.query(
    'UPDATE keys SET banned = true WHERE key = $1 AND api = $2 RETURNING *',
    [key, api]
  );
  
  if (result.rows.length === 0) {
    return res.status(200).json({ success: false, message: 'Key not found' });
  }
  
  return res.status(200).json({ success: true, message: 'Key banned successfully' });
}

async function handleCheckKey(body, res) {
  const { api, key, user_id } = body;
  
  if (!api || !key || !user_id) {
    return res.status(400).json({ success: false, message: 'API, Key and User ID are required' });
  }

  const permission = await checkAppPermission(user_id, api);
  if (!permission.hasPermission) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền xem key của application này' });
  }

  const result = await pool.query(
    'SELECT * FROM keys WHERE key = $1 AND api = $2',
    [key, api]
  );
  
  if (result.rows.length === 0) {
    return res.status(200).json({ success: false, message: 'Key not found' });
  }
  
  return res.status(200).json({ 
    success: true, 
    message: 'Key information',
    key: result.rows[0] 
  });
}

async function handleResetHWID(body, res) {
  const { api, key, user_id } = body;
  
  if (!api || !key || !user_id) {
    return res.status(400).json({ success: false, message: 'API, Key and User ID are required' });
  }

  const permission = await checkAppPermission(user_id, api);
  if (!permission.hasPermission) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền reset HWID của application này' });
  }

  const result = await pool.query(
    `UPDATE keys SET hwid = NULL, used = false, system_info = NULL, first_used = NULL 
     WHERE key = $1 AND api = $2 RETURNING *`,
    [key, api]
  );
  
  if (result.rows.length === 0) {
    return res.status(200).json({ success: false, message: 'Key not found' });
  }
  
  return res.status(200).json({ success: true, message: 'HWID reset successfully' });
}

async function handleListKeys(body, res) {
  const { api, user_id } = body;
  
  if (!api || !user_id) {
    return res.status(400).json({ success: false, message: 'API and User ID are required' });
  }

  const permission = await checkAppPermission(user_id, api);
  if (!permission.hasPermission) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền xem keys của application này' });
  }

  const result = await pool.query(
    `SELECT key, used, banned, expires_at, created_at, hwid 
     FROM keys WHERE api = $1 ORDER BY created_at DESC`,
    [api]
  );
  
  return res.status(200).json({ 
    success: true, 
    keys: result.rows 
  });
}

async function handleGetKeys(body, res) {
  const { api, user_id } = body;
  
  if (!api || !user_id) {
    return res.status(400).json({ success: false, message: 'API and User ID are required' });
  }

  const permission = await checkAppPermission(user_id, api);
  if (!permission.hasPermission) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền xem keys của application này' });
  }

  const result = await pool.query(
    'SELECT * FROM keys WHERE api = $1 ORDER BY created_at DESC',
    [api]
  );
  
  return res.status(200).json({ 
    success: true, 
    keys: result.rows 
  });
}

async function handleAddSupport(body, res) {
  const { user_id, admin_id } = body;
  
  if (!user_id || !admin_id) {
    return res.status(400).json({ success: false, message: 'Thiếu ID người dùng hoặc ID Admin' });
  }

  const isAdmin = await checkIfAdmin(admin_id);
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền thêm support' });
  }

  try {
    const checkExist = await pool.query('SELECT * FROM supports WHERE user_id = $1', [user_id]);
    
    if (checkExist.rows.length > 0) {
      return res.status(200).json({ 
        success: false, 
        message: `Lỗi: ID [${user_id}] đã tồn tại trong danh sách support rồi!` 
      });
    }

    await pool.query(
      'INSERT INTO supports (user_id, added_by, added_at) VALUES ($1, $2, NOW())',
      [user_id, admin_id]
    );
    
    return res.status(200).json({ success: true, message: `Đã thêm thành công support: ${user_id}` });

  } catch (error) {
    if (error.code === '23505') {
      return res.status(200).json({ success: false, message: 'ID này đã tồn tại!' });
    }
    return res.status(500).json({ success: false, message: 'Lỗi server: ' + error.message });
  }
}

async function handleDeleteSupport(body, res) {
  const { user_id, admin_id } = body;
  
  if (!user_id || !admin_id) {
    return res.status(400).json({ success: false, message: 'User ID and Admin ID are required' });
  }

  const isAdmin = await checkIfAdmin(admin_id);
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: 'Chỉ admin mới có thể xóa support' });
  }

  if (user_id === MAIN_ADMIN_ID) {
    return res.status(400).json({ success: false, message: 'Cannot delete main admin' });
  }

  const result = await pool.query(
    'DELETE FROM supports WHERE user_id = $1 RETURNING *',
    [user_id]
  );
  
  if (result.rows.length === 0) {
    return res.status(200).json({ success: false, message: 'Support user not found' });
  }
  
  return res.status(200).json({ success: true, message: 'Support user deleted successfully' });
}

async function handleGetSupports(res) {
  try {
    const result = await pool.query('SELECT * FROM supports ORDER BY added_at DESC');
    return res.status(200).json({ 
      success: true, 
      supports: result.rows 
    });
  } catch (error) {
    console.error('❌ Lỗi Get Supports:', error);
    return res.status(500).json({ success: false, message: 'Không thể tải danh sách support' });
  }
}

async function handleValidateKey(body, res) {
  const { api, key, hwid, system_info } = body;

  if (!api || !key || !hwid) {
    return res.status(400).json({ success: false, message: 'API, Key, HWID are required' });
  }

  const appResult = await pool.query(
    'SELECT * FROM applications WHERE api_key = $1',
    [api]
  );
  if (appResult.rows.length === 0) {
    return res.status(200).json({ success: false, message: 'Invalid API' });
  }

  const keyResult = await pool.query(
    'SELECT * FROM keys WHERE key = $1 AND api = $2',
    [key, api]
  );
  if (keyResult.rows.length === 0) {
    return res.status(200).json({ success: false, message: 'Invalid key' });
  }

  const k = keyResult.rows[0];

  if (k.banned) {
    return res.status(200).json({ success: false, message: 'Key banned' });
  }

  const now = new Date();
  const expires = new Date(k.expires_at);
  if (now > expires) {
    return res.status(200).json({ success: false, message: 'Key expired' });
  }

  let hwids = [];
  if (k.hwid) {
    try {
      hwids = JSON.parse(k.hwid);
    } catch {
      hwids = [];
    }
  }

  if (hwids.includes(hwid)) {
    return res.status(200).json({ success: true, message: 'Valid key' });
  }

  const limit = k.device_limit || 1;
  if (hwids.length >= limit) {
    return res.status(200).json({ success: false, message: 'Key limited' });
  }

  hwids.push(hwid);

  await pool.query(
    `UPDATE keys 
     SET hwid = $1,
         used = true,
         system_info = $2,
         first_used = COALESCE(first_used, CURRENT_TIMESTAMP)
     WHERE key = $3 AND api = $4`,
    [JSON.stringify(hwids), system_info, key, api]
  );

  return res.status(200).json({ success: true, message: 'Valid key' });
}

function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
