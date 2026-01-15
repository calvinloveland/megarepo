#pragma once

#include "Expression.hpp"

namespace ast {
    class Division : public Expression {
    public:
        Division(Expression *l, Expression *r) : Expression(l, r) {}
    };
}