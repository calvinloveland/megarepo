%{
#include <iostream>
#include <map>

#include "includes.hpp"

extern int yylex();
void yyerror(const char*);

std::shared_ptr<ast::Program> pNode;

%}

%union
{

float val;
char* id;
ast::Program* program_ptr;
ast::Block* block_ptr;
ast::StatementSequence* statementSequence_ptr;
ast::Expression* expression_ptr;
ast::Statement* statement_ptr;
ast::Stop* stop_ptr;
}

%token SNOTEQUAL
%token SLESSEQUAL
%token SGREATEREQUAL
%token SASSIGNMENT

%token SPLUS
%token SMINUS
%token SMULT
%token SDIV
%token SNUMBER
%token SID
%token SEQUAL
%token SOPENPAREN
%token SCLOSEPAREN
%token SSEMICOLON
%token SNEWLINE
%token SPERIOD
%token SCOMMA
%token SPIPE
%token SAMPERSAND
%token SOPENANGLE
%token SCLOSEANGLE
%token SPERCENTAGE
%token STILDE
%token SCOLON
%token SOPENSQUARE
%token SCLOSESQUARE

%token KARRAY
%token KBEGIN
%token KCHR
%token KCONST
%token KDO
%token KDOWNTO
%token KELSE
%token KELSEIF
%token KEND
%token KFOR
%token KFORWARD
%token KFUNCTION
%token KIF
%token KOF
%token KORD
%token KPRED
%token KPROCEDURE
%token KREAD
%token KRECORD
%token KREF
%token KREPEAT
%token KRETURN
%token KSTOP
%token KSUCC
%token KTHEN
%token KTO
%token KTYPE
%token KUNTIL
%token KVAR
%token KWHILE
%token KWRITE

%token IDENTIFIER
%token CHARACTER
%token STRING
%token NUMBER

%left SMULT
%left SDIV
%left SPLUS
%left SMINUS
%left SPERCENT
%left SAMPERSAND
%left SPIPE

%nonassoc SNOTEQUAL
%nonassoc SLESSEQUAL
%nonassoc SGREATEREQUAL
%nonassoc SOPENANGLE
%nonassoc SCLOSEANGLE
%nonassoc SEQUAL

%right UNARYMINUS
%right STILDE

%type <program_ptr> Program
%type <block_ptr> Block
%type <statementSequence_ptr> StatementSequence
%type <statement_ptr> Statement
%type <expression_ptr> Expression
%type <statement_ptr> Assignment
%type <statement_ptr> IfStatement
%type <statement_ptr> RepeatStatement
%type <statement_ptr> ForStatement
%type <stop_ptr> StopStatement
%type <statement_ptr> ReturnStatement
%type <statement_ptr> ReadStatement
%type <statement_ptr> WriteStatement
%type <statement_ptr> ProcedureCall
%type <statement_ptr> NullStatement
%type <statement_ptr> WhileStatement



%%

Program : OptConstantDecl OptTypeDecl OptVarDecl OptFuncOrProcDecl Block SPERIOD {std::cerr << "Program\n"; pNode = std::make_shared<ast::Program>($5);};

OptConstantDecl : KCONST SubConstantDecl {}
		|
		;
	       
SubConstantDecl : IDENTIFIER SEQUAL Expression SSEMICOLON OptSubConstantDecl {std::cerr << "OptConstDecl\n";}
		;

OptSubConstantDecl : SubConstantDecl
		   |
		   ;

OptVarDecl : KVAR SubVarDecl
	   |
	   ;

SubVarDecl : IdentifierList SCOLON Type SSEMICOLON OptSubVarDecl {std::cerr<<"VarDecl\n";};

OptSubVarDecl : SubVarDecl
	      |
	      ;

OptFuncOrProcDecl : FunctionDecl OptFuncOrProcDecl
 	          | ProcedureDecl OptFuncOrProcDecl
		  |
	          ;

ProcedureDecl : KPROCEDURE IDENTIFIER SOPENPAREN FormalParameters SCLOSEPAREN SSEMICOLON KFORWARD SSEMICOLON
	      | KPROCEDURE IDENTIFIER SOPENPAREN FormalParameters SCLOSEPAREN SSEMICOLON Body SSEMICOLON
	      ;

FunctionDecl : KFUNCTION IDENTIFIER SOPENPAREN FormalParameters SCLOSEPAREN SCOLON Type SSEMICOLON KFORWARD SSEMICOLON
	     | KFUNCTION IDENTIFIER SOPENPAREN FormalParameters SCLOSEPAREN SCOLON Type SSEMICOLON Body SSEMICOLON
	     ;

FormalParameters : VarOrRef IdentifierList SCOLON Type OptFormalParameters
		 |
		 ;
		
OptFormalParameters : SSEMICOLON VarOrRef IdentifierList SCOLON Type OptFormalParameters
		    |
		    ;

VarOrRef : KVAR
	 | KREF
	 | 
	 ;

Body : OptConstantDecl OptTypeDecl OptVarDecl Block;

Block : KBEGIN StatementSequence KEND {std::cerr<<"Block\n"; $$ = new ast::Block($2);};

OptTypeDecl : KTYPE SubTypeDecl
	    |
	    ;

SubTypeDecl : IDENTIFIER SEQUAL Type SSEMICOLON SubTypeDecl
	       | IDENTIFIER SEQUAL Type SSEMICOLON
	       ;

Type : SimpleType
     | RecordType
     | ArrayType
     ;

SimpleType : IDENTIFIER;

RecordType : KRECORD OptRecordType KEND;

OptRecordType : IdentifierList SCOLON Type SSEMICOLON OptRecordType
	      |
	      ;

ArrayType : KARRAY SOPENSQUARE Expression SCOLON Expression SCLOSESQUARE KOF Type;

IdentifierList : IDENTIFIER OptIdentifier;

OptIdentifier : SCOMMA IDENTIFIER OptIdentifier
	      |
	      ;

StatementSequence : Statement {$$ = ast::MakeStatementSequence($1);}
		  | Statement SSEMICOLON StatementSequence {$$ = ast::MakeStatementSequence($1,$3);}
		  ;

Statement : Assignment
	  | IfStatement
	  | RepeatStatement
	  | ForStatement
	  | StopStatement 
	  | ReturnStatement
	  | ReadStatement
	  | WriteStatement
	  | ProcedureCall
	  | NullStatement
	  | WhileStatement
	  {std::cerr << "Statement\n"; $$ = $1;};

Assignment : LValue SASSIGNMENT Expression;

IfStatement : KIF Expression KTHEN StatementSequence OptElseIf OptElse KEND;

OptElseIf : KELSEIF Expression KTHEN StatementSequence OptElseIf
	  |
	  ;

OptElse : KELSE StatementSequence
	|
	;

WhileStatement : KWHILE Expression KDO StatementSequence KEND;

RepeatStatement : KREPEAT StatementSequence KUNTIL Expression;

ForStatement : KFOR IDENTIFIER SASSIGNMENT Expression ToOrDownto Expression KDO StatementSequence KEND;

ToOrDownto : KTO
	   | KDOWNTO
	   ;

StopStatement : KSTOP {$$ = new ast::Stop();};

ReturnStatement : KRETURN OptExpression;

ReadStatement : KREAD SOPENPAREN LValue OptLValue SCLOSEPAREN ;

WriteStatement : KWRITE SOPENPAREN Expression OptAddExpression SCLOSEPAREN {std::cerr<<"WriteStatement\n"; $$ = new WriteStatement(MakeExpressionList($3,$4));};

ProcedureCall : IDENTIFIER SOPENPAREN OptExpressions SCLOSEPAREN;

NullStatement : {std::cerr<<"NullStatement\n";};

Expression : SMINUS Expression %prec UNARYMINUS {$$ = new ast::UnaryMinus(dynamic_cast<ast::Expression*>($2));}
	   | Expression SPERCENTAGE Expression 
	   | Expression SDIV Expression {$$ = ast::makeDiv(dynamic_cast<ast::Expression*>($1),dynamic_cast<ast::Expression*>($3));}
	   | Expression SMULT Expression {$$ = ast::makeMult(dynamic_cast<ast::Expression*>($1),dynamic_cast<ast::Expression*>($3));}
	   | Expression SPLUS Expression {$$ = ast::makeAdd(dynamic_cast<ast::Expression*>($1),dynamic_cast<ast::Expression*>($3));}
	   | Expression SMINUS Expression {$$ = ast::makeSub(dynamic_cast<ast::Expression*>($1), dynamic_cast<ast::Expression*>($3));}
	   | Expression SEQUAL Expression {$$ = new ast::Equal(dynamic_cast<ast::Expression*>($1),dynamic_cast<ast::Expression*>($3));}
	   | Expression SNOTEQUAL Expression {$$ = new ast::NotEqual(dynamic_cast<ast::Expression*>($1),dynamic_cast<ast::Expression*>($3));}
	   | Expression SGREATEREQUAL Expression
	   | Expression SLESSEQUAL Expression
	   | Expression SOPENANGLE Expression
	   | Expression SCLOSEANGLE Expression
	   | STILDE Expression
	   | Expression SAMPERSAND Expression
	   | Expression SPIPE Expression
	   | SOPENPAREN Expression SCLOSEPAREN
	   | IDENTIFIER SOPENPAREN OptExpressions SCLOSEPAREN
	   | KCHR SOPENPAREN Expression SCLOSEPAREN
	   | KORD SOPENPAREN Expression SCLOSEPAREN
	   | KPRED SOPENPAREN Expression SCLOSEPAREN
	   | KSUCC SOPENPAREN Expression SCLOSEPAREN
	   | LValue
	   | STRING
	   | CHARACTER
	   | NUMBER
	    {std::cerr<<"Expression\n";};

OptLValue : SCOMMA LValue OptLValue
	  |
	  ;


OptIdOrExpression : SPERIOD IDENTIFIER OptIdOrExpression
		  | SOPENSQUARE Expression SCLOSESQUARE OptIdOrExpression
		  | 
		  ;
OptExpressions : Expression OptAddExpression
	       |
	       ;

OptExpression : Expression
	      |
	      ;

OptAddExpression : SCOMMA Expression OptAddExpression
		 |
		 ;

LValue : IDENTIFIER OptIdOrExpression;

%%

void yyerror(const char* msg)
{
  std::cerr << msg << std::endl;
}

