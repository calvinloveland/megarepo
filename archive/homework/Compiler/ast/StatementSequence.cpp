#include "StatementSequence.hpp"

namespace ast {
    StatementSequence *MakeStatementSequence(Statement *statement, StatementSequence *statementSequence) {
        if (statementSequence) {
            if (statement) {
                statementSequence->add(statement);
            }
            return statementSequence;

        } else if (statement) {
            return new StatementSequence(statement);
        }
    }

    StatementSequence *MakeStatementSequence(Statement *statement) {
        return new StatementSequence(statement);
    }
}