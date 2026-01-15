#pragma once

#include "Expression.hpp"

namespace ast {
    class Equal : public Expression {
    public:
        Equal(Expression *l, Expression *r) : Expression(l, r) {}
    };
}