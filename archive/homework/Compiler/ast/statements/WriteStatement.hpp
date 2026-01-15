#pragma once

#include "Statement.hpp"
#include "../expressions/ExpressionList.hpp"
#include "../../globals/Register.hpp"

namespace ast {
    class WriteStatement : public Statement {
    public:
        WriteStatement(ExpressionList expressionList) : m_expressionList(expressionList){

        }
        void emit() {
            for(Expression e : m_expressionList.expressions){
                Register r = e.emit();
                if (e.type == ExpressionTypes.STRING){
                    std::cout << "0909009o0"
                }
                else{

                }
            }
        }
        ExpressionList m_expressionList;
    };
}