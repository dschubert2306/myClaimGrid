// Fake environment so AWS SDK clients can sign locally. No network calls are made in tests.
process.env.AWS_REGION = 'eu-central-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.TABLE_NAME = 'test-table';
process.env.BUCKET_NAME = 'test-bucket';
process.env.LOG_SILENT = '1';
