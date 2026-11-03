import { handleCompose } from '../src/server/compose';

export function POST(req: Request) {
  return handleCompose(req, process.env);
}
