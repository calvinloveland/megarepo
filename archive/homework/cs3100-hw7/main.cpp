#include<stdlib.h>
#include<limits.h>
#include<algorithm>
#include<iostream>
#include<vector>
#include<fstream>

using namespace std;

int main(){
	
	const int REFERENCES = 1000;
	const int FRAMES = 100;
	const int PAGES = 250;
	const int SEQUENCES = 100;
			
	ofstream resultsFile;
	resultsFile.open("results.csv");

	int anomalies=0;
	vector<vector<int>> references(SEQUENCES, vector<int>(REFERENCES));
	vector<vector<int>> faults(SEQUENCES, vector<int>(FRAMES));
	
	cout << "Sequences tested: " << SEQUENCES << endl;
	cout << "Length of memory reference string: " << REFERENCES << endl;
	cout << "Frames of physical memory: " << FRAMES << endl << endl;
	
	for (int i =0; i < SEQUENCES; i++){
		for (int j = 0; j < REFERENCES; j++){
			references[i][j] = rand() % PAGES;
		}
	}

	

	for(int frameCount = 1; frameCount < FRAMES; frameCount++){
		//cout << "Working on frame: " << frameCount;
		vector<int> frame;
		for (int sequence = 0; sequence < SEQUENCES; sequence++){
			int currentFaultCount = 0;
			for(int get = 0; get < REFERENCES; get++){
				if(find(frame.begin(),frame.end(),references[sequence][get]) == frame.end()){
					currentFaultCount++;
					frame.insert(frame.begin(),references[sequence][get]);
					if(frame.size() > frameCount){
						frame.pop_back();
					}
				}
			}
			if(frameCount > 1){
				if(faults[sequence][frameCount -1] < currentFaultCount){
					cout << "Anomaly Discovered!" << endl;
					cout << "Sequence: " << sequence << endl;
					cout << "Page Faults: " << faults[sequence][frameCount - 1] << " Frame Size: " << frameCount - 1 << endl;
					cout << "Page Faults: " << currentFaultCount << " Frame Size: " << frameCount << endl << endl;
					anomalies++;
				}
			}
			faults[sequence][frameCount] = currentFaultCount;
			resultsFile << currentFaultCount << ",";
		}
		resultsFile << endl;
	}
	cout << "Anomaly detected " << anomalies << " times." << endl;
	resultsFile.close();
	return 0;
}
