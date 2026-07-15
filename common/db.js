import mongoose from 'mongoose';
import logger from './logger';

mongoose.set('strictQuery', true);

const connectToDB = async () => {
  if (!process.env.DB_URL) {
    console.error('FATAL: DB_URL is not set in .env — cannot start without a database connection.');
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.DB_URL);
    console.log('Database connected successfully');
  } catch (err) {
    console.error('FATAL: Database connection failed —', err.message);
    logger.error('Database connection error', err);
    process.exit(1);
  }

  mongoose.connection.on('error', err => {
    logger.error('Database connection error', err);
  });

  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('Database disconnected');
    process.exit(0);
  });
};

export default connectToDB;
