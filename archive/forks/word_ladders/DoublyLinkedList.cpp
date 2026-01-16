#include "Node.cpp"

template <class T>
class DoublyLinkedList {
public:
	DoublyLinkedList();
	Node<T>* beginning;
	Node<T>* end;
	void push(T);
	T pop();
	int length();
};

template <class T>
DoublyLinkedList<T>::DoublyLinkedList() {}

template <class T>
void DoublyLinkedList<T>::push(T v) {
	Node<T>* n = new Node<T>(v);
	if (beginning == nullptr) {
		beginning = n;
		end = n;
	}
	else {
		end->next = n;
		n->prev = end;
		end = n;
	}
}

template <class T>
T DoublyLinkedList<T>::pop() {
	T returnVal = beginning->val;
	if (beginning == end) {
		beginning = nullptr;
		end = nullptr;
	}
	else {
		beginning = beginning->next;
		beginning->prev = nullptr;
	}
	return returnVal;
}

template <class T>
int DoublyLinkedList<T>::length() {
	int returnVal = 0;
	/*if (beginning == nullptr) //Necessary?
		return returnVal;*/
	Node<T>* current = beginning;
	while (current != nullptr) {
		returnVal++;
		current = current->next;
	}
	//cout << "LENGTH: " << returnVal << "\n";
	return returnVal;
}