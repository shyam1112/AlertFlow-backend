import morgan from 'morgan';
import express from 'express';
import cors from 'cors';

export default app => {
  app.use(
    morgan(':method :url :status :response-time ms - :res[content-length]'),
  );
  app.use(express.json({ limit: '2mb', extended: true }));
  app.use(cors());
};
