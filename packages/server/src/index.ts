import 'dotenv/config';
import Koa from 'koa';
import cors from '@koa/cors';
import bodyParser from 'koa-bodyparser';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/error.js';
import router from './router.js';

const app = new Koa();
const PORT = process.env.PORT || 3001;

app.use(requestId);
app.use(errorHandler);
app.use(cors());
app.use(bodyParser());

app.use(router.routes());
app.use(router.allowedMethods());

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (process.env.MOCK_ENGINE === 'true') {
    console.log(`  ⚠️  Mock engine enabled — using simulated opencode responses`);
    console.log(`      MOCK_TASK_DELAY=${process.env.MOCK_TASK_DELAY || 2000}ms  MOCK_FAILURE_RATE=${process.env.MOCK_FAILURE_RATE || 0}  MOCK_FAIL_AFTER=${process.env.MOCK_FAIL_AFTER || 0}`);
  }
});
