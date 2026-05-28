import { createClient } from '@libsql/client';

const token = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiJiMjg4MTBmZi1kOTY1LTRmMzUtYTAzOC0wOGRjOGIyOWM1YmMiLCJpYXQiOjE3Nzk4NTgyMTUsInJpZCI6IjVlNjRhMTk1LTY1M2EtNGUzNS1iY2Q5LTI5YjRmNTg1NWU4NiJ9.jq-LhlK2yW_xjUV6eb2VeSHl63fcQja64a1vnuvFjH8_4t1Pvv3Uom6xqDmMnhPzutS8oiGzzhG1MVzI03HNDQ';

const dbName = 'tlo-farm-' + Date.now();
const url = `libsql://${dbName}.turso.io`;

console.log('Testing connection to:', url);

const client = createClient({ url, authToken: token });

client.execute('SELECT 1').then(r => {
  console.log('Connected!');
  console.log(r);
}).catch(err => {
  console.error('Error:', err.message);
});
