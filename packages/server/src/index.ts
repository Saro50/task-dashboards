import 'dotenv/config';
import Koa from 'koa';
import cors from '@koa/cors';
import bodyParser from 'koa-bodyparser';
import { errorHandler } from './middleware/error.js';
import router from './router.js';

const app = new Koa();
const PORT = process.env.PORT || 3001;

app.use(errorHandler);
app.use(cors());
app.use(bodyParser());

app.use(router.routes());
app.use(router.allowedMethods());

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
