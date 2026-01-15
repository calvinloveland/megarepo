#pragma once

#include<sys/types.h>
#include<sys/wait.h>
#include<unistd.h>
#include<signal.h>
#include<time.h>

void sendSig(int);
int time();
void sleep(int);
void birth();
