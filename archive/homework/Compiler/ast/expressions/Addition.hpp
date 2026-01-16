#pragma once

#include "Expression.hpp"

namespace ast {
    class Addition : public Expression {
    public:
        Addition(Expression *l, Expression *r) : Expression(l, r) {}
    };
}