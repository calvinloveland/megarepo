#include "ExpressionList.hpp"

namespace ast {
    ExpressionList *MakeExpressionList(Expression *e, ExpressionList *expressionList){
        if (expressionList) {
            if (e) {
                expressionList->add(e);
            }
            return expressionList;

        } else if (e) {
            return new StatementSequence(e);
        }
    }

    ExpressionList *MakeExpressionList(Expression *e){
        return new StatementSequence(e);
    }
}