#pragma once

#include "Expression.hpp"

namespace ast {
    class Multiplication : public Expression {
    public:
        Multiplication(Expression *l, Expression *r) : Expression(l, r) {}
    };
}