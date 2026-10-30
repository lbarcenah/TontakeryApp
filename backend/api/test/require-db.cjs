if (!process.env.TEST_DATABASE_URL) {
  console.error(
    'Set TEST_DATABASE_URL to run the PostgreSQL integration suite.',
  );
  process.exit(1);
}
