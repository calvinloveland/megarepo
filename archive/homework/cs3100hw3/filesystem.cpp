#include"filesystem.hpp"

std::string whereAmI(){
	char buffer[64];
	std::string answer = getcwd(buffer, sizeof(buffer));
	std::cout << answer;
	return answer;
}

void changeDirectory(){
	chdir(whereAmI().c_str());
}

void checkAccess(){
	access("/proc/self/exe",R_OK);
}

void commitToDisk(){
		sync();
}

void changeOwner(){
	chmod("/proc/self/exe",0777);
}

void duplicate(){
	std::ofstream newFile("file.txt");
	newFile << "Some Text" << std::endl;
	newFile.close();

	int file_desc = open("file.txt", O_WRONLY | O_APPEND);
	dup2(file_desc,1);
	std::cout << "More Text" << std::endl;
	dup2(1,file_desc);
	close(file_desc);
}
