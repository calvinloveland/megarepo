export type AST = any;

export interface InterpreterOptions {
  maxOps: number;
}

export class Interpreter {
  ast: AST;
  ops = 0;
  maxOps: number;

  constructor(ast: AST, options?: InterpreterOptions) {
    this.ast = ast;
    this.maxOps = options?.maxOps ?? (ast.budgets?.max_ops || 100);
  }

  step(cellCtx: any) {
    this.ops = 0;
    for (const p of this.ast.primitives) {
      if (this.ops > this.maxOps) break;
      this.execPrimitive(p, cellCtx);
      if (cellCtx.intent) break;
    }
  }

  execPrimitive(p: any, ctx: any) {
    // enforce exact budget: do not increment ops beyond maxOps
    if (this.ops >= this.maxOps) return;
    this.ops++;
    switch (p.op) {
      case 'move':
        // move is handled by sim layer; write intent to ctx
        ctx.intent = {type:'move', dx:p.dx, dy:p.dy};
        break;
      case 'read':
        // read neighbor
        ctx.lastRead = ctx.readNeighbor(p.dx, p.dy);
        break;
      case 'if':
        // simple if cond with eq on lastRead
        const cond = p.cond;
        if (cond && cond.eq && ctx.lastRead === cond.eq.value) {
          for (const sub of p.then || []) this.execPrimitive(sub, ctx);
        }
        break;
      case 'rand':
        // set lastRead randomly based on probability (defaults to 0.5)
        const prob = typeof p.probability === 'number' ? p.probability : 0.5;
        ctx.lastRead = Math.random() < prob ? 1 : 0;
        break;
      default:
        // no-op
        break;
    }
  }
}
