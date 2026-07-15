import mongoose from 'mongoose';
import logger from './logger';

const connectToDB = async () => {
  try {
    await mongoose.connect(process.env.DB_URL);
    console.log('Database connected successfully');
  } catch (err) {
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
