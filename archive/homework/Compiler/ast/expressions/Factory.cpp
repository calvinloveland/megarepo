#include "Factory.hpp"

namespace ast {

    Expression *makeAdd(Expression *l, Expression *r) {
        if (l->isConst() && r->isConst()) {
            return new Value(l->value() + r->value());
        } else {
            return new Addition(l, r);
        }
    }

    Expression *makeMult(Expression *l, Expression *r) {
        if (l->isConst() && r->isConst()) {
            return new Value(l->value() * r->value());
        } else {
            return new Multiplication(l, r);
        }
    }

    Expression *makeDiv(Expression *l, Expression *r) {
        if (l->isConst() && r->isConst()) {
            return new Value(l->value() / r->value());
        } else {
            return new Division(l, r);
        }
    }

    Expression *makeSub(Expression *l, Expression *r) {
        if (l->isConst() && r->isConst()) {
            return new Value(l->value() - r->value());
        } else {
            return new Subtraction(l, r);
        }
    }
}