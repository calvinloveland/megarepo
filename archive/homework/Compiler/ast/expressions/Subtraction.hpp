#pragma once

#include "Expression.hpp"

namespace ast {
    class Subtraction : public Expression {
    public:
        Subtraction(Expression *l, Expression *r) : Expression(l, r) {}
    };
}