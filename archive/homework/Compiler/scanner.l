%{
#include <cstdlib>
#include <iostream>

#include "includes.hpp"

#include "parser.hpp"


%}

%option noyywrap



%%


"<>" {return SNOTEQUAL;}
"<=" {return SLESSEQUAL;}
">=" {return SGREATEREQUAL;}
":=" {return SASSIGNMENT;}


"+" {return SPLUS;}
"-" {return SMINUS;}
"*" {return SMULT;}
"/" {return SDIV;}
"(" {return SOPENPAREN;}
")" {return SCLOSEPAREN;}
"[" {return SOPENSQUARE;}
"]" {return SCLOSESQUARE;}
";" {return SSEMICOLON;}
"=" {return SEQUAL;}
"." {return SPERIOD;}
"," {return SCOMMA;}
"|" {return SPIPE;}
"&" {return SAMPERSAND;}
"<" {return SOPENANGLE;}
">" {return SCLOSEANGLE;}
"%" {return SPERCENTAGE;}
"~" {return STILDE;}
":" {return SCOLON;}

(ARRAY|array) {std::cerr << "Keyword: ARRAY\n" ;return KARRAY;}
(BEGIN|begin) {std::cerr << "Keyword: BEGIN\n" ;return KBEGIN;}
(CHR|chr) {std::cerr << "Keyword: CHR\n" ;return KCHR;}
(CONST|const) {std::cerr << "Keyword: CONST\n" ;return KCONST;}
(DO|do) {std::cerr << "Keyword: DO\n" ;return KDO;}
(DOWNTO|downto) {std::cerr << "Keyword: DOWNTO\n" ;return KDOWNTO;}
(ELSE|else) {std::cerr << "Keyword: ELSE\n" ;return KELSE;}
(ELSEIF|elseif) {std::cerr << "Keyword: ELSEIF\n" ;return KELSEIF;}
(END|end) {std::cerr << "Keyword: END\n" ;return KEND;}
(FOR|for) {std::cerr << "Keyword: FOR\n" ;return KFOR;}
(FORWARD|forward) {std::cerr << "Keyword: FORWARD\n" ;return KFORWARD;}
(FUNCTION|function) {std::cerr << "Keyword: FUNCTION\n" ;return KFUNCTION;}
(IF|if) {std::cerr << "Keyword: IF\n" ;return KIF;}
(OF|of) {std::cerr << "Keyword: OF\n" ;return KOF;}
(ORD|ord) {std::cerr << "Keyword: ORD\n" ;return KORD;}
(PRED|pred) {std::cerr << "Keyword: PRED\n" ;return KPRED;}
(PROCEDURE|procedure) {std::cerr << "Keyword: PROCEDURE\n" ;return KPROCEDURE;}
(READ|read) {std::cerr << "Keyword: READ\n" ;return KREAD;}
(RECORD|record) {std::cerr << "Keyword: RECORD\n" ;return KRECORD;}
(REF|ref) {std::cerr << "Keyword: REF\n" ;return KREF;}
(REPEAT|repeat) {std::cerr << "Keyword: REPEAT\n" ;return KREPEAT;}
(RETURN|return) {std::cerr << "Keyword: RETURN\n" ;return KRETURN;}
(STOP|stop) {std::cerr << "Keyword: STOP\n" ;return KSTOP;}
(SUCC|succ) {std::cerr << "Keyword: SUCC\n" ;return KSUCC;}
(THEN|then) {std::cerr << "Keyword: THEN\n" ;return KTHEN;}
(TO|to) {std::cerr << "Keyword: TO\n" ;return KTO;}
(TYPE|type) {std::cerr << "Keyword: TYPE\n" ;return KTYPE;}
(UNTIL|until) {std::cerr << "Keyword: UNTIL\n" ;return KUNTIL;}
(VAR|var) {std::cerr << "Keyword: VAR\n" ;return KVAR;}
(WHILE|while) {std::cerr << "Keyword: WHILE\n" ;return KWHILE;}
(WRITE|write) {std::cerr << "Keyword: WRITE\n" ;return KWRITE;}

0[0-7]+          {return NUMBER;}
0x[0-9a-fA-F]+ {return NUMBER;}
[0-9]*\.[0-9]* {std::cerr << "Number\n"; yylval.val = atof(yytext);return NUMBER;}
[0-9]+ {std::cerr << "Number\n"; yylval.val = atof(yytext);return NUMBER;}

\'([^']|\\n|\\r|\\t)\' {std::cerr << "CHARACTER\n";return CHARACTER;}
\"[a-zA-Z0-9~`!@'#$%^&*()_+=\-\[\]{}\\\/><,.:;| ]*\" {std::cerr << "STRING\n";return STRING;}

[a-zA-Z][a-zA-Z0-9_]* {std::cerr << "Identifier: "<< yytext << "\n"; return IDENTIFIER;}

[ \t]+ {std::cerr<<"Whitespace\n";}
\n {std::cerr<<"Newline\n";}

. {std::cerr << "BROKE" << "|" << yytext << "|\n";}

%%
