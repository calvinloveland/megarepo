#pragma once

#include "Expression.hpp"
#include <vector>

namespace ast {
    class ExpressionList : public Node {
    public:
        ExpressionList(Expression *e) { add(e); }

        void add(Expression* e) { expressions.push_back(e); }

        void emit() {
            std::cerr << "Emitting ExpressionList" << std::endl;
            for (Expression *e : expressions) {
                std::cerr << "Emitting Expression" << std::endl;
                if (e) {
                    e->emit();
                }
            }
        }

        std::vector<Expression *> expressions;
    };


    ExpressionList *MakeExpressionList(Expression *e, ExpressionList *expressionList);

    ExpressionList *MakeExpressionList(Expression *e);
}