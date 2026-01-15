
template <class T>
class Node {
public:
	Node(T);
	Node(T, Node*, Node*);
	T val;
	Node* next;
	Node* prev;
};

template <class T>
Node<T>::Node(T v) {
	val = v;
}

template <class T>
Node<T>::Node(T v, Node* n, Node* p) {
	val = v;
	next = n;
	prev = p;
}