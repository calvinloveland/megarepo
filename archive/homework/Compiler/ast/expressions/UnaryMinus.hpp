#pragma once

#include "Expression.hpp"

namespace ast {
    class UnaryMinus : public ast::Expression {
    public:
        UnaryMinus(Expression *n) : Expression(n, nullptr) {}
    };
}