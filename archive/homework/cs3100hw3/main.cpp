#include<iostream>
#include<csignal>
#include<sys/types.h>
#include<unistd.h>

#include "c++lang.hpp"
#include "process.hpp"
#include "filesystem.hpp"

using namespace std;

bool quittingTime = false;

void sigint(int signal) {
		quittingTime = true;
}

int main(int argc, char *argv[]){
	signal(SIGINT, sigint);
	bool handled = false;
	bool realQuit = false;
	while(!realQuit){
		if(argc == 2 && !handled){
		}
		else{
			cout<<"\nTime Waster 3000. PID: " << getpid() <<
			"\n(0) Check Reality with Division"
			"\n(1) Check Reality with Square Roots"
			"\n(2) Allocate and Clean Memory"
			"\n(3) Just Allocate Memory"
			"\n(4) Can I Message Myself?"
			"\n(5) Send Myself a Message"
			"\n(6) Get the Time"
			"\n(7) Nanosleep"
			"\n(8) Microsleep"
			"\n(9) Millisleep"
			"\n(10) Regular 'ol Sleep"
			"\n(11) Birth a Child"
			"\n(12) Where Am I?"
			"\n(13) Change Where I Am"
			"\n(14) Can I Access that?"
			"\n(15) Commit To The Disk"
			"\n(16) Change Permissions"
			"\n(17) Whatever Dup2 Does"
			"\n(18) Quit"
			"\nWhat would you like to do?: ";
			int response;
			cin >> response;
			cin.clear();
			switch (response) {
					case 0:
						divide();
						break;
					case 1:
						squareRoot();
						break;
					case 2:
						allocate(true);
						break;
					case 3:
						allocate(false);
						break;
					case 4:
						sendSig(0);
						break;
					case 5:
						sendSig(SIGUSR2);
						break;
					case 6:
						time();
						break;
					case 7:
						sleep(1);
						break;
					case 8:
						sleep(1000);
						break;
					case 9:
						sleep(1000000);
						break;
					case 10:
						sleep(1000000000);
						break;
					case 11:
						birth();
						break;
					case 12:
						whereAmI();
						break;
					case 13:
						changeDirectory();
						break;
					case 14:
						checkAccess();
						break;
					case 15:
						commitToDisk();
						break;
					case 16:
						changeOwner();
						break;
					case 17:
						duplicate();
						break;
					case 18:
						realQuit = true;
					default:
						break;
			}
			quittingTime = false;
		}
	}


}
