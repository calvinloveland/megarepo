#pragma once

#include "Expression.hpp"

namespace ast {
    class Value : public Expression {
    public:
        Value(float value) { v = value; }

        float value() { return v; }

    private:
        float v;
    };
}