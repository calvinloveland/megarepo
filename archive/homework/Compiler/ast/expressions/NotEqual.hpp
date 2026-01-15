#pragma once

#include "Expression.hpp"

namespace ast {
    class NotEqual : public ast::Expression {
    public:
        NotEqual(Expression *l, Expression *r) : Expression(l, r) {}
    };
}