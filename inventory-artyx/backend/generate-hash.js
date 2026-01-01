const bcrypt = require('bcrypt');

bcrypt.hash('test123', 10).then(hash => {
  console.log('Bcrypt hash for "test123":');
  console.log(hash);
  process.exit(0);
});
