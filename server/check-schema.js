const { query } = require('./src/config/database.js');
query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'work_logs' AND table_schema = 'public' ORDER BY ordinal_position")
  .then(r => { 
    console.log('=== work_logs columns ===');
    r.forEach(c => console.log(' ', c.column_name, ':', c.data_type)); 
    process.exit(0); 
  })
  .catch(e => { console.error(e.message); process.exit(1); });
