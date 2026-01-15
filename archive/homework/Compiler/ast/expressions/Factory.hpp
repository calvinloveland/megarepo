#pragma once

#include "Addition.hpp"
#include "Division.hpp"
#include "Multiplication.hpp"
#include "Subtraction.hpp"
#include "Value.hpp"

namespace ast {
    Expression *makeAdd(Expression *l, Expression *r);
    Expression *makeMult(Expression *l, Expression *r);
    Expression *makeDiv(Expression *l, Expression *r);
    Expression *makeSub(Expression *l, Expression *r);
}
