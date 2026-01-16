#pragma once

#include "../Node.hpp"

namespace ast {
    enum ExpressionTypes {STRING, INT};

    class Expression : public Node {
    public:
        Expression() {}

        Expression(Expression *left, Expression *right) {
            l = left;
            r = right;
        }

        bool isConst() { return false; }

        virtual float value(){return 0;}

        Expression *l;
        Expression *r;
    };
}
