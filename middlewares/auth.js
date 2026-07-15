import jwt from 'jsonwebtoken';

const verifyToken = (req, res, next) => {
  let token = req.headers['authorization'];
  if (token && token.startsWith('Bearer ')) {
    token = token.slice(7);
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).send({ message: 'Unauthorized' });
      }
      req.shopName = decoded.shopName;
      next();
    });
  } else {
    return res.status(401).send({ message: 'Unauthorized' });
  }
};

export default verifyToken;
